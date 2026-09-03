import { expect, test } from '@playwright/test'

test('landing page and recovery workspace remain inspectable without overflow', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bring old keys safely forward.' })).toBeVisible()
  await expect(page.getByText('No seed upload')).toBeVisible()
  await page.getByRole('button', { name: 'Start a recovery plan' }).click()
  await expect(page.getByRole('heading', { name: 'Find it. Prove it. Move it.' })).toBeVisible()
  await expect(page.getByLabel('Recovery words')).toHaveAttribute('autocomplete', 'off')
  await expect(page.getByRole('button', { name: 'Scan verified paths' })).toBeDisabled()
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth)
  expect(errors).toEqual([])
})

test('wallet catalog exposes evidence and safe exceptions', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Wallet guides' }).click()
  await expect(page.getByRole('heading', { name: 'Know what kind of backup you have.' })).toBeVisible()
  await page.getByText('ElectrumSV / ElectrumSVP', { exact: true }).click()
  await expect(page.getByText('Electrum v1 seeds, multisig wallets and hardware-wallet descriptors')).toBeVisible()
  await page.getByPlaceholder('Find Centbee, ElectrumSV, Coinomi…').fill('HandCash')
  await expect(page.getByText('HandCash (current)', { exact: true })).toBeVisible()
})
