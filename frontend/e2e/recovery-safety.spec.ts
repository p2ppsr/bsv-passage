import { expect, test, type Page } from '@playwright/test'
import { migrationFixture, testReference, testWords } from '../test-fixtures/migration'

async function startMockRecovery(page: Page, options: { badHeader?: boolean, disagree?: boolean, highFee?: boolean } = {}) {
  const f = migrationFixture()
  if (options.highFee) f.tx.outputs[0].satoshis = 1
  // No real provider or wallet traffic: requests outside the test server are
  // fulfilled with synthetic fixtures or rejected, including wallet discovery.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4173') return route.continue()
    if (!['api.whatsonchain.com', 'api.bitails.io'].includes(url.hostname)) return route.abort()
    const addresses = route.request().postDataJSON()?.addresses ?? []
    let body: unknown
    if (url.hostname === 'api.whatsonchain.com' && url.pathname.endsWith('/addresses/history/all')) {
      body = addresses.map((address: string) => ({ address, confirmed: { result: address === f.derived.address ? [{}] : [] }, unconfirmed: { result: [] } }))
    } else if (url.hostname === 'api.bitails.io' && url.pathname.endsWith('/balance/multi/separate')) {
      body = addresses.map((address: string) => ({ address, confirmed: address === f.derived.address ? 10000 : 0, unconfirmed: 0, summary: address === f.derived.address ? 10000 : 0, count: address === f.derived.address ? 1 : 0 }))
    } else if (url.hostname === 'api.whatsonchain.com' && url.pathname.endsWith(`/address/${f.derived.address}/unspent/all`)) {
      body = { result: [{ tx_hash: f.source.id('hex'), tx_pos: 0, value: 10000, height: 800000 }] }
    } else if (url.hostname === 'api.bitails.io' && url.pathname.endsWith('/unspent/multi')) {
      body = [{ address: f.derived.address, unspent: [{ txid: f.source.id('hex'), vout: 0, satoshis: 10000, height: options.disagree ? 0 : 800000 }] }]
    } else if (url.hostname === 'api.whatsonchain.com' && url.pathname.endsWith(`/tx/${f.source.id('hex')}/beef`)) {
      return route.fulfill({ status: 200, contentType: 'text/plain', body: f.source.toHexBEEF(), headers: { 'Access-Control-Allow-Origin': '*' } })
    } else return route.abort()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.addInitScript(({ tx, header, reference }) => {
    const w = window as unknown as { CWI: unknown, recoveryMock: { releaseAllowed: boolean, signCalls: number, abortCalls: number } }
    w.recoveryMock = { releaseAllowed: false, signCalls: 0, abortCalls: 0 }
    w.CWI = {
      getVersion: async () => ({ version: 'review-fixture' }),
      isAuthenticated: async () => ({ authenticated: true }),
      getNetwork: async () => ({ network: 'mainnet' }),
      listActions: async () => ({ totalActions: 0, actions: [] }),
      createAction: async () => ({ signableTransaction: { reference, tx } }),
      getHeaderForHeight: async () => ({ header }),
      abortAction: async () => { w.recoveryMock.abortCalls++; return { aborted: w.recoveryMock.releaseAllowed } },
      signAction: async () => { w.recoveryMock.signCalls++; throw new Error('Synthetic uncertain outcome') },
    }
  }, { tx: f.tx.toAtomicBEEF(), header: options.badHeader ? '00'.repeat(80) : f.header, reference: testReference })
  await page.goto('/')
  await page.getByRole('button', { name: 'Start a recovery plan' }).click()
  await page.getByLabel('Wallet', { exact: true }).selectOption('rockwallet')
  await page.getByLabel('Recovery words').fill(testWords)
  await page.getByRole('button', { name: 'Advanced discovery' }).click()
  await page.getByLabel('Unused address gap').fill('5')
  await page.getByRole('button', { name: 'Scan verified paths' }).click()
  await expect(page.getByText('Verified balance', { exact: true })).toBeVisible()
}

async function prepare(page: Page) {
  await page.getByRole('checkbox', { name: 'I have an offline backup' }).check()
  await page.getByRole('checkbox', { name: 'The old wallet is closed' }).check()
  await page.getByRole('checkbox', { name: 'I authorize this transaction' }).check()
  await page.getByRole('button', { name: 'Connect wallet & prepare review' }).click()
}

async function allowRelease(page: Page) {
  await page.evaluate(() => { (window as unknown as { recoveryMock: { releaseAllowed: boolean } }).recoveryMock.releaseAllowed = true })
}

test('confirmation disagreement blocks preparation in the browser', async ({ page }) => {
  await startMockRecovery(page, { disagree: true })
  await expect(page.getByText('Independent results differ')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect wallet & prepare review' })).toHaveCount(0)
})

test('refused cancellation retains the exact proposal and requires new consent after release', async ({ page }) => {
  await startMockRecovery(page)
  await prepare(page)
  await expect(page.getByText('Locally signed, not broadcast')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeDisabled()
  const consent = page.getByRole('checkbox', { name: 'I reviewed the amount' })
  await consent.check()
  await page.getByRole('button', { name: 'Cancel proposal', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('did not release action')
  await expect(page.getByText('Locally signed, not broadcast')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeDisabled()
  await allowRelease(page)
  await page.getByRole('button', { name: 'Cancel proposal', exact: true }).click()
  await expect(page.getByText('Locally signed, not broadcast')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Connect wallet & prepare review' }).click()
  await expect(page.getByText('Locally signed, not broadcast')).toBeVisible()
  await expect(consent).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Authorize wallet broadcast' })).toBeDisabled()
})

test('failed prepare retains an unreleased reference and blocks navigation and retry', async ({ page }) => {
  await startMockRecovery(page, { badHeader: true })
  await prepare(page)
  const recovery = page.getByRole('alert').filter({ hasText: 'Wallet action still needs reconciliation' })
  await expect(recovery).toContainText(testReference)
  await expect(page.getByRole('button', { name: 'Connect wallet & prepare review' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Retry releasing action' }).click()
  await expect(recovery).toContainText(testReference)
  await allowRelease(page)
  await page.getByRole('button', { name: 'Retry releasing action' }).click()
  await expect(recovery).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => (window as unknown as { recoveryMock: { signCalls: number } }).recoveryMock.signCalls)).toBe(0)
})

test('uncertain broadcast preserves the review and locks repeat send and cancellation', async ({ page }) => {
  await startMockRecovery(page)
  await prepare(page)
  await page.getByRole('checkbox', { name: 'I reviewed the amount' }).check()
  await page.getByRole('button', { name: 'Authorize wallet broadcast' }).click()
  await expect(page.getByText('Broadcast outcome needs manual resolution')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Authorize wallet broadcast' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel proposal', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Wallet guides', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => (window as unknown as { recoveryMock: { signCalls: number, abortCalls: number } }).recoveryMock)).toMatchObject({ signCalls: 1, abortCalls: 0 })
})

test('failed cleanup after signing keeps the full TXID readable without mobile overflow', async ({ page }) => {
  await startMockRecovery(page, { highFee: true })
  await prepare(page)
  const recovery = page.getByRole('alert').filter({ hasText: 'Wallet action still needs reconciliation' })
  await expect(recovery).toContainText(/Expected TXID: [a-f0-9]{64}/)
  await expect(recovery).toContainText(testReference)
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }))
  expect(dimensions.width).toBe(dimensions.viewport)
})
