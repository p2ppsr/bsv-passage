import { useEffect, useMemo, useRef, useState } from 'react'
import { WalletClient, type HD } from '@bsv/sdk'
import {
  ArrowRight, BookOpen, ChevronRight, CircleAlert, CircleCheck, ExternalLink,
  Github, KeyRound, LifeBuoy, LoaderCircle, LockKeyhole, Radar, RefreshCw,
  Route, ShieldCheck, Sparkles, TriangleAlert, WalletCards, X,
} from 'lucide-react'
import './App.css'
import { getProfile, getWallet, readyWallets, wallets, type WalletEntry } from './lib/catalog'
import { createMasterKey } from './lib/seed'
import {
  BSV_BCH_SPLIT_HEIGHT, hasReplayAmbiguity, hasUnconfirmed, scanProfile,
  type ScanReport,
} from './lib/providers'
import {
  abortPreparedMigration, commitMigration, flattenSources, prepareMigration,
  smallestPilot, type MigrationReceipt, type PreparedMigration,
} from './lib/migration'

type Page = 'home' | 'migrate' | 'guides' | 'safety'
type MigrationMode = 'pilot' | 'all'

const walletClient = new WalletClient()
const HIGH_VALUE_GUIDANCE_SATS = 10_000_000

function formatSats(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-7)}`
}

function StatusPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /></span>
}

function Header({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  const links: { page: Page; label: string }[] = [
    { page: 'migrate', label: 'Migrate' }, { page: 'guides', label: 'Wallet guides' }, { page: 'safety', label: 'Safety' },
  ]
  return <header className="site-header">
    <button className="brand" onClick={() => setPage('home')} aria-label="BSV Passage home"><Mark /><span>BSV Passage</span></button>
    <nav aria-label="Primary navigation">
      {links.map((link) => <button key={link.page} className={page === link.page ? 'nav-active' : ''} onClick={() => setPage(link.page)}>{link.label}</button>)}
      <a href="https://github.com/p2ppsr/bsv-passage" target="_blank" rel="noreferrer"><Github size={17} /> Source</a>
    </nav>
  </header>
}

function Home({ begin, openGuides }: { begin: () => void; openGuides: () => void }) {
  return <main>
    <section className="hero-section">
      <img className="hero-art" src="/passage-hero.png" alt="Many fine paths converging through a warm, illuminated passage" />
      <div className="hero-copy">
        <StatusPill tone="good"><ShieldCheck size={14} /> Browser-local recovery</StatusPill>
        <h1>Bring old keys<br />safely forward.</h1>
        <p>Find standard P2PKH funds from historical Bitcoin SV wallets, verify them through independent indexers, and move a reviewed transaction into your BRC-100 wallet.</p>
        <div className="hero-actions">
          <button className="button primary" onClick={begin}>Start a recovery plan <ArrowRight size={18} /></button>
          <a className="button quiet" href="#how-it-works">See how it works</a>
        </div>
        <div className="trust-row"><span><LockKeyhole size={16} /> No seed upload</span><span><Radar size={16} /> Two-source verification</span><span><Route size={16} /> Replay-risk stop</span></div>
      </div>
    </section>

    <section className="proof-strip" aria-label="Project proof">
      <div><strong>{wallets.length}</strong><span>wallet families documented</span></div>
      <div><strong>{readyWallets.reduce((sum, wallet) => sum + wallet.profiles.length, 0)}</strong><span>reviewed scan profiles</span></div>
      <div><strong>2</strong><span>independent BSV indexers</span></div>
      <div><strong>0</strong><span>seed words sent to servers</span></div>
    </section>

    <section id="how-it-works" className="section compact-section">
      <div className="eyebrow">A careful path, not a black box</div>
      <h2>Three deliberate steps</h2>
      <div className="steps-grid">
        <article><span>01</span><KeyRound /><h3>Match</h3><p>Select the wallet and exact historical derivation profile. Checksummed phrases are derived only in this tab.</p></article>
        <article><span>02</span><Radar /><h3>Verify</h3><p>Passage continues through the address gap only when both providers respond, and locks migration when UTXO sets differ.</p></article>
        <article><span>03</span><WalletCards /><h3>Review & move</h3><p>Your BRC-100 wallet proposes its own receiving output. Passage verifies every source, fee and signature before you authorize the wallet to broadcast.</p></article>
      </div>
    </section>

    <section className="section split-callout">
      <div><div className="eyebrow">Universal means honest</div><h2>Every wallet gets a route—even when it cannot be swept.</h2></div>
      <div><p>BRC-42 outputs, threshold accounts, multisig policies and undocumented legacy formats are not safely recoverable by guessing BIP-44 paths. Passage identifies those boundaries and sends people to the right restore or export workflow.</p><button className="text-link" onClick={openGuides}>Explore the catalog <ChevronRight size={17} /></button></div>
    </section>
  </main>
}

function MigrationWorkspace() {
  const firstWallet = readyWallets[0]
  const [walletId, setWalletId] = useState(firstWallet.id)
  const [profileId, setProfileId] = useState(firstWallet.profiles[0].id)
  const [words, setWords] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [showWords, setShowWords] = useState(false)
  const [gapLimit, setGapLimit] = useState(20)
  const [accountCount, setAccountCount] = useState(1)
  const [advanced, setAdvanced] = useState(false)
  const [busy, setBusy] = useState('')
  const [progressCount, setProgressCount] = useState(0)
  const [error, setError] = useState('')
  const [report, setReport] = useState<ScanReport>()
  const [prepared, setPrepared] = useState<PreparedMigration>()
  const [broadcastUncertain, setBroadcastUncertain] = useState(false)
  const [receipt, setReceipt] = useState<MigrationReceipt>()
  const [mode, setMode] = useState<MigrationMode>('pilot')
  const [checks, setChecks] = useState({ backup: false, stopped: false, liability: false, final: false })
  const [highValueOverride, setHighValueOverride] = useState(false)
  const masterRef = useRef<HD>(undefined)
  const abortRef = useRef<AbortController>(undefined)
  const preparedRef = useRef<PreparedMigration>(undefined)

  useEffect(() => () => {
    if (preparedRef.current) void abortPreparedMigration(walletClient, preparedRef.current).catch(() => undefined)
  }, [])

  const selectedWallet = getWallet(walletId)
  const selectedProfile = getProfile(walletId, profileId)
  const sources = report ? flattenSources(report) : []
  const pilotSources = report ? smallestPilot(report) : []
  const selectedSources = mode === 'pilot' ? pilotSources : sources.slice(0, 100)
  const hasReplayRisk = report ? hasReplayAmbiguity(report) : false
  const unconfirmed = report ? hasUnconfirmed(report) : false
  const highValue = (report?.totalSatoshis ?? 0) >= HIGH_VALUE_GUIDANCE_SATS
  const canPrepare = Boolean(report && report.totalSatoshis > 0 && report.providersAgree && !hasReplayRisk && !unconfirmed && checks.backup && checks.stopped && checks.liability && !prepared && (!highValue || mode === 'pilot' || highValueOverride))

  function resetSensitive(clearReceipt = false) {
    abortRef.current?.abort()
    masterRef.current = undefined
    setWords('')
    setPassphrase('')
    setReport(undefined)
    setPrepared(undefined)
    preparedRef.current = undefined
    setBroadcastUncertain(false)
    setChecks({ backup: false, stopped: false, liability: false, final: false })
    if (clearReceipt) setReceipt(undefined)
  }

  async function clearSession() {
    if (prepared && !broadcastUncertain) {
      setBusy('Releasing the proposed wallet action')
      try {
        await abortPreparedMigration(walletClient, prepared)
      } catch (caught) {
        setError(`The wallet action could not be released. Keep this page open and try Cancel proposal again. ${caught instanceof Error ? caught.message : String(caught)}`)
        setBusy('')
        return
      }
    }
    resetSensitive(true)
    setBusy('')
  }

  function changeWallet(nextWalletId: string) {
    resetSensitive()
    const next = getWallet(nextWalletId)
    setWalletId(nextWalletId)
    setProfileId(next.profiles[0].id)
    setError('')
  }

  async function startScan(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setReceipt(undefined)
    setPrepared(undefined)
    setReport(undefined)
    setProgressCount(0)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setBusy('Checking the phrase locally')
      const master = createMasterKey(words, passphrase, selectedProfile.seedFormat)
      masterRef.current = master
      setWords('')
      setPassphrase('')
      setBusy('Beginning independent address discovery')
      const nextReport = await scanProfile(master, selectedProfile, {
        gapLimit, accountCount, signal: controller.signal,
        onProgress: (message, completed) => { setBusy(message); setProgressCount(completed) },
      })
      setReport(nextReport)
      setBusy('')
    } catch (caught) {
      if ((caught as { name?: string }).name !== 'AbortError') setError(caught instanceof Error ? caught.message : String(caught))
      setBusy('')
    }
  }

  async function prepare() {
    if (!report || !masterRef.current) return
    setError('')
    try {
      setBusy('Connecting to your BRC-100 wallet')
      const next = await prepareMigration(walletClient, masterRef.current, report, selectedSources, setBusy)
      setPrepared(next)
      preparedRef.current = next
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally { setBusy('') }
  }

  async function cancelPrepared() {
    if (!prepared) return
    setBusy('Releasing the proposed wallet action')
    try { await abortPreparedMigration(walletClient, prepared); setPrepared(undefined); preparedRef.current = undefined }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy('') }
  }

  async function broadcast() {
    if (!prepared || !checks.final) return
    setError('')
    setBusy('Broadcasting once—do not close this page')
    try {
      const nextReceipt = await commitMigration(walletClient, prepared)
      setReceipt(nextReceipt)
      preparedRef.current = undefined
      masterRef.current = undefined
      setWords('')
      setPassphrase('')
      setPrepared(undefined)
      setReport(undefined)
      setChecks({ backup: false, stopped: false, liability: false, final: false })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      preparedRef.current = undefined
      setBroadcastUncertain(true)
    } finally { setBusy('') }
  }

  return <main className="workspace-shell">
    <section className="workspace-intro">
      <div><div className="eyebrow">Recovery workspace</div><h1>Find it. Prove it. Move it.</h1><p>Nothing is broadcast until the source proofs, exact inputs, receiving transaction and fee pass review.</p></div>
      <div className="privacy-card"><ShieldCheck /><div><strong>Your secret stays here</strong><span>Words are cleared from the form immediately after derivation. No analytics, accounts, seed API, cloud clipboard or recovery database.</span></div></div>
    </section>

    <div className="workspace-grid">
      <section className="panel recovery-panel">
        <div className="panel-title"><span className="number">1</span><div><h2>Identify the old wallet</h2><p>Start with a documented profile.</p></div></div>
        <label className="field-label" htmlFor="wallet-select">Wallet</label>
        <select id="wallet-select" value={walletId} onChange={(event) => changeWallet(event.target.value)} disabled={Boolean(prepared) || Boolean(busy)}>
          {readyWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.status}</option>)}
        </select>
        <div className="profile-choices" role="radiogroup" aria-label="Derivation profile">
          {selectedWallet.profiles.map((profile) => <label key={profile.id} className={profile.id === profileId ? 'choice selected' : 'choice'}>
            <input type="radio" name="profile" value={profile.id} checked={profile.id === profileId} disabled={Boolean(prepared) || Boolean(busy)} onChange={() => { resetSensitive(); setProfileId(profile.id); setError('') }} />
            <span><strong>{profile.label}</strong><small>{profile.templates.join(' · ')}</small></span><StatusPill tone={profile.confidence === 'verified' ? 'good' : 'neutral'}>{profile.confidence}</StatusPill>
          </label>)}
        </div>
        <div className="source-note"><BookOpen size={17} /><span>{selectedProfile.note ?? selectedWallet.summary} <a href={selectedProfile.source} target="_blank" rel="noreferrer">Source <ExternalLink size={12} /></a></span></div>

        <form onSubmit={startScan} className="seed-form">
          <div className="field-heading"><label className="field-label" htmlFor="seed-words">Recovery words</label><button type="button" className="tiny-button" onClick={() => setShowWords((value) => !value)}>{showWords ? 'Hide' : 'Show'}</button></div>
          <textarea id="seed-words" className={showWords ? '' : 'secret-text'} value={words} disabled={Boolean(prepared)} onChange={(event) => { setWords(event.target.value); setReport(undefined); masterRef.current = undefined }} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} placeholder={selectedProfile.seedFormat === 'electrum-v2' ? 'Standard Electrum seed words' : '12, 15, 18, 21 or 24 BIP-39 words'} required rows={4} />
          <label className="field-label" htmlFor="seed-passphrase">{walletId === 'centbee' ? 'Original four-digit PIN' : 'Optional seed passphrase'}</label>
          <input id="seed-passphrase" type="password" value={passphrase} disabled={Boolean(prepared)} onChange={(event) => setPassphrase(event.target.value)} autoComplete="off" spellCheck={false} placeholder={walletId === 'centbee' ? 'Required for Centbee' : 'Leave blank if none'} required={walletId === 'centbee'} />
          <button className="advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)}>Advanced discovery <span>{advanced ? '−' : '+'}</span></button>
          {advanced && <div className="advanced-grid">
            <label>Unused address gap<input type="number" min="5" max="100" value={gapLimit} onChange={(event) => setGapLimit(Number(event.target.value))} /></label>
            <label>BIP-44 accounts<input type="number" min="1" max="20" value={accountCount} onChange={(event) => setAccountCount(Number(event.target.value))} disabled={!selectedProfile.templates.some((path) => path.includes('{account}'))} /></label>
          </div>}
          <button className="button primary wide" type="submit" disabled={Boolean(busy) || words.trim().length === 0}>{busy ? <><LoaderCircle className="spin" size={18} /> Working safely</> : <>Scan verified paths <Radar size={18} /></>}</button>
          {busy && <div className="progress-box"><div><span className="pulse-dot" />{busy}</div><small>{progressCount > 0 ? `${progressCount} addresses checked · both providers required` : 'No secret material leaves this tab'}</small><button type="button" onClick={() => abortRef.current?.abort()}>Cancel</button></div>}
        </form>
      </section>

      <section className="panel results-panel">
        <div className="panel-title"><span className="number">2</span><div><h2>Verify the recovery map</h2><p>Provider agreement is a broadcast prerequisite.</p></div></div>
        {!report && !receipt && <div className="empty-state"><Route /><h3>Your verified map will appear here</h3><p>Passage scans receiving and change branches until the selected unused-address gap is proven by both providers.</p></div>}
        {report && <>
          <div className="balance-block"><span>Verified balance</span><strong>{formatSats(report.totalSatoshis)} <small>sats</small></strong><em>{(report.totalSatoshis / 100_000_000).toFixed(8)} BSV</em></div>
          <div className="verification-grid">
            <div><CircleCheck /><span><strong>{report.addressesChecked}</strong> addresses checked</span></div>
            <div className={report.providersAgree ? '' : 'danger-text'}>{report.providersAgree ? <CircleCheck /> : <CircleAlert />}<span><strong>{report.providersAgree ? 'Matched' : 'Mismatch'}</strong> indexer UTXOs</span></div>
            <div className={hasReplayRisk ? 'danger-text' : ''}>{hasReplayRisk ? <TriangleAlert /> : <CircleCheck />}<span><strong>{hasReplayRisk ? 'Blocked' : 'Clear'}</strong> replay screen</span></div>
            <div className={unconfirmed ? 'warn-text' : ''}>{unconfirmed ? <TriangleAlert /> : <CircleCheck />}<span><strong>{unconfirmed ? 'Wait' : 'Confirmed'}</strong> source outputs</span></div>
          </div>
          {hasReplayRisk && <div className="alert danger"><TriangleAlert /><div><strong>Pre-split output detected</strong><p>An output was created at or before height {formatSats(BSV_BCH_SPLIT_HEIGHT)}. Automatic signing is disabled because the outpoint may still be spendable on BCH.</p></div></div>}
          {!report.providersAgree && <div className="alert danger"><CircleAlert /><div><strong>Independent results differ</strong><p>Do not migrate or assume either result is current. Wait, scan again, then use a third reviewed explorer if disagreement persists.</p></div></div>}
          {report.totalSatoshis === 0 && report.providersAgree && <div className="alert neutral"><LifeBuoy /><div><strong>No spendable standard outputs found</strong><p>Check the passphrase/PIN, wallet profile, accounts and wallet-specific caveat. An empty result is not proof the backup has no value.</p></div></div>}
          <div className="address-list">
            {report.funded.filter((entry) => entry.satoshis > 0 || !entry.providersAgree).slice(0, 20).map((entry) => <div className="address-row" key={`${entry.path}:${entry.address}`}>
              <div><strong>{entry.path}</strong><span title={entry.address}>{shortAddress(entry.address)}</span></div>
              <div><strong>{entry.providersAgree ? `${formatSats(entry.satoshis)} sats` : 'Provider mismatch'}</strong><span>{entry.utxos.length} output{entry.utxos.length === 1 ? '' : 's'}</span></div>
            </div>)}
          </div>
          {sources.length > 0 && <div className="move-box">
            <div className="panel-title inline"><span className="number">3</span><div><h2>Move into BRC-100</h2><p>Prepare first. Broadcast separately.</p></div></div>
            <div className="mode-switch">
              <button className={mode === 'pilot' ? 'selected' : ''} onClick={() => setMode('pilot')}><Sparkles />Pilot one output<small>{pilotSources[0] ? `${formatSats(pilotSources[0].utxo.satoshis)} sats` : 'Unavailable'}</small></button>
              <button className={mode === 'all' ? 'selected' : ''} onClick={() => setMode('all')}><WalletCards />{sources.length > 100 ? 'Next 100 outputs' : 'All verified outputs'}<small>{formatSats(sources.slice(0, 100).reduce((sum, source) => sum + source.utxo.satoshis, 0))} sats</small></button>
            </div>
            {highValue && mode === 'all' && !highValueOverride && <label className="override-check"><input type="checkbox" checked={highValueOverride} onChange={(event) => setHighValueOverride(event.target.checked)} /><span><strong>Large-balance safeguard</strong>I have already completed and confirmed a pilot, or I accept that a single-output wallet cannot be meaningfully piloted.</span></label>}
            <div className="check-list">
              <label><input type="checkbox" checked={checks.backup} onChange={(event) => setChecks({ ...checks, backup: event.target.checked })} /><span>I have an offline backup and verified one known old address where possible.</span></label>
              <label><input type="checkbox" checked={checks.stopped} onChange={(event) => setChecks({ ...checks, stopped: event.target.checked })} /><span>The old wallet is closed and will not create another transaction during migration.</span></label>
              <label><input type="checkbox" checked={checks.liability} onChange={(event) => setChecks({ ...checks, liability: event.target.checked })} /><span>I authorize this transaction and accept sole responsibility for ownership, tax, replay, key-exposure and transaction risk. P2PPSR and contributors do not custody funds and disclaim liability to the fullest extent permitted by law.</span></label>
            </div>
            {!prepared && <button className="button primary wide" disabled={!canPrepare || Boolean(busy)} onClick={prepare}>Connect wallet & prepare review <ArrowRight size={18} /></button>}
          </div>}
        </>}

        {prepared && <div className="review-card">
          <div className="review-heading"><ShieldCheck /><div><strong>Locally signed, not broadcast</strong><span>Confirm the exact proposal below.</span></div></div>
          <dl><div><dt>Source</dt><dd>{formatSats(prepared.sourceSatoshis)} sats</dd></div><div><dt>Wallet outputs</dt><dd>{formatSats(prepared.outputSatoshis)} sats</dd></div><div><dt>Network fee</dt><dd>{formatSats(prepared.feeSatoshis)} sats · {prepared.feeRate.toFixed(2)} sat/kB</dd></div><div><dt>Shape</dt><dd>{prepared.inputCount} input{prepared.inputCount === 1 ? '' : 's'} → {prepared.outputCount} output{prepared.outputCount === 1 ? '' : 's'}</dd></div><div><dt>Expected TXID</dt><dd className="mono" title={prepared.txid}>{shortAddress(prepared.txid)}</dd></div></dl>
          <details><summary>Inspect signed transaction hex</summary><code className="tx-code">{prepared.txHex}</code></details>
          <label className="final-check"><input type="checkbox" checked={checks.final} onChange={(event) => setChecks({ ...checks, final: event.target.checked })} /><span>I reviewed the amount, fee and expected transaction ID. Authorize my BRC-100 wallet to broadcast exactly once.</span></label>
          {broadcastUncertain && <div className="alert danger"><TriangleAlert /><div><strong>Broadcast outcome needs manual resolution</strong><p>Do not broadcast or abort again. Check expected TXID {prepared.txid} and the source outpoints before clearing this session.</p></div></div>}
          <div className="review-actions"><button className="button quiet" onClick={cancelPrepared} disabled={Boolean(busy) || broadcastUncertain}><X size={17} /> Cancel proposal</button><button className="button danger-button" onClick={broadcast} disabled={!checks.final || Boolean(busy) || broadcastUncertain}>Authorize wallet broadcast <ArrowRight size={17} /></button></div>
        </div>}

        {receipt && <div className="complete-card"><CircleCheck /><div><div className="eyebrow">Wallet broadcast complete</div><h2>{formatSats(receipt.sourceSatoshis - receipt.feeSatoshis)} sats passed forward.</h2><p>The secret-derived key has been released from Passage state. Confirm the new balance in your BRC-100 wallet before retiring the old backup.</p><a className="button primary" href={`https://whatsonchain.com/tx/${receipt.txid}`} target="_blank" rel="noreferrer">Verify transaction <ExternalLink size={17} /></a></div></div>}
      </section>
    </div>
    {error && <div className="toast-error" role="alert"><CircleAlert /><div><strong>Passage stopped safely</strong><span>{error}</span></div><button onClick={() => setError('')} aria-label="Dismiss"><X /></button></div>}
    <div className="workspace-footer"><button onClick={clearSession} disabled={Boolean(busy)}><RefreshCw size={15} /> Clear this recovery session</button><span>Closing or reloading the tab is the strongest browser-memory cleanup.</span></div>
  </main>
}

function GuideCard({ wallet }: { wallet: WalletEntry }) {
  const tone = wallet.support === 'ready' ? 'good' : wallet.support === 'guided' ? 'warn' : 'neutral'
  return <details className="guide-card">
    <summary><div><h3>{wallet.name}</h3><span>{wallet.era} · {wallet.status}</span></div><StatusPill tone={tone}>{wallet.support === 'ready' ? 'Scan ready' : wallet.support === 'guided' ? 'Guided route' : 'No seed sweep'}</StatusPill><ChevronRight className="chevron" /></summary>
    <div className="guide-body"><p>{wallet.summary}</p>{wallet.profiles.length > 0 && <div className="path-block">{wallet.profiles.map((profile) => <div key={profile.id}><strong>{profile.label}</strong><code>{profile.templates.join('  ·  ')}</code><a href={profile.source} target="_blank" rel="noreferrer">{profile.sourceLabel} <ExternalLink size={12} /></a></div>)}</div>}
      <ol>{wallet.steps.map((step) => <li key={step}>{step}</li>)}</ol>{wallet.caveat && <div className="caveat"><TriangleAlert />{wallet.caveat}</div>}</div>
  </details>
}

function Guides() {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => wallets.filter((wallet) => `${wallet.name} ${wallet.summary} ${wallet.status}`.toLowerCase().includes(query.toLowerCase())), [query])
  return <main className="content-page"><div className="page-heading"><div className="eyebrow">Historical wallet field guide</div><h1>Know what kind of backup you have.</h1><p>A wallet name is only a starting point. Versions, coin types, passphrases and custody models changed. Every automatic profile below links to its evidence.</p></div>
    <div className="catalog-toolbar"><input type="search" placeholder="Find Centbee, ElectrumSV, Coinomi…" value={query} onChange={(event) => setQuery(event.target.value)} /><div><StatusPill tone="good">Scan ready</StatusPill><StatusPill tone="warn">Guided</StatusPill><StatusPill>No seed sweep</StatusPill></div></div>
    <section className="guide-list">{filtered.map((wallet) => <GuideCard key={wallet.id} wallet={wallet} />)}</section>
    <section className="missing-wallet"><LifeBuoy /><div><h2>Wallet missing or path uncertain?</h2><p>Stop before signing. Open an issue with the wallet name, exact version, backup type and a public address you already know. Never post words, private keys, PINs, xprvs or screenshots containing them.</p></div><a className="button quiet" href="https://github.com/p2ppsr/bsv-passage/issues/new" target="_blank" rel="noreferrer">Open a safe research issue <ExternalLink size={16} /></a></section>
  </main>
}

function Safety() {
  return <main className="content-page"><div className="page-heading"><div className="eyebrow">Safety model</div><h1>Designed to stop before doubt becomes loss.</h1><p>No software can promise zero risk. Passage narrows the risk, exposes every assumption and refuses transactions outside its proven envelope.</p></div>
    <section className="safety-grid">
      <article><LockKeyhole /><h2>Local secret boundary</h2><p>Phrase and passphrase processing happens in the browser. They are never intentionally logged, persisted, measured or sent. Addresses are public and are sent to two indexers for discovery.</p></article>
      <article><Radar /><h2>Independent agreement</h2><p>WhatsOnChain and Bitails must return the same outpoint and value set. Provider failure, disagreement, unconfirmed inputs or changed values lock signing.</p></article>
      <article><Route /><h2>Replay stop</h2><p>Outputs created at or before BSV/BCH split height {formatSats(BSV_BCH_SPLIT_HEIGHT)} are not automatically signed. A same-key transaction can otherwise move value on another chain.</p></article>
      <article><ShieldCheck /><h2>Transaction invariants</h2><p>Every input must be a proven standard P2PKH output, match its derived key and verified value, appear exactly once, and sign all outputs. Unexpected inputs and out-of-bounds fees abort the wallet action.</p></article>
      <article><RefreshCw /><h2>Ambiguous broadcast recovery</h2><p>Passage computes the expected TXID before broadcast and never auto-retries an uncertain send. Check that TXID, source outpoints and BRC-100 history before taking another action.</p></article>
      <article><BookOpen /><h2>Reproducible scrutiny</h2><p>No remote fonts, analytics or third-party scripts. Source, lockfile, release checksum, threat model and browser bundle are public. High-value users should run a reviewed release locally.</p></article>
    </section>
    <section className="legal-box"><TriangleAlert /><div><h2>Authorization and responsibility</h2><p>You must own or be authorized to move every selected output. You choose the wallet profile, words, passphrase, indexers, target wallet and transaction. P2PPSR, its members, contributors and infrastructure operators do not custody funds, verify title, provide financial/tax/legal advice, or guarantee compatibility or recovery. The software is provided as-is under the Open BSV License; you bear transaction, replay, key-exposure, device, provider, compliance and tax risk, and liability is disclaimed to the fullest extent permitted by applicable law. Rights that cannot lawfully be waived remain unaffected.</p></div></section>
    <section className="do-dont"><div><h2>Before a meaningful balance</h2><ul><li>Use a clean, updated device and close screen sharing, password managers and browser extensions you do not trust.</li><li>Verify the release checksum or build from the public commit.</li><li>Check a known address and migrate the smallest verified output first.</li><li>Keep the old backup offline until the destination balance and confirmation are independently visible.</li></ul></div><div><h2>Passage intentionally does not</h2><ul><li>Upload, escrow or recover forgotten words or passphrases.</li><li>Guess undocumented paths and sign whatever appears.</li><li>Split replayable BSV/BCH outputs or sweep tokens and custom scripts as P2PKH.</li><li>Reconstruct BRC-42 metadata, certificates, baskets, labels, multisig policy or custodial accounts.</li></ul></div></section>
  </main>
}

function Footer() {
  return <footer><div className="brand footer-brand"><Mark /><span>BSV Passage</span></div><p>Open BSV License · Built for careful ecosystem stewardship.</p><div><a href="https://github.com/p2ppsr/bsv-passage/blob/master/SECURITY.md" target="_blank" rel="noreferrer">Security</a><a href="https://github.com/p2ppsr/bsv-passage/blob/master/docs/THREAT-MODEL.md" target="_blank" rel="noreferrer">Threat model</a><a href="https://github.com/p2ppsr/bsv-passage" target="_blank" rel="noreferrer">Source</a></div></footer>
}

function App() {
  const [page, setPage] = useState<Page>('home')
  return <div className="app-shell">
    <Header page={page} setPage={setPage} />
    {page === 'home' && <Home begin={() => setPage('migrate')} openGuides={() => setPage('guides')} />}
    {page === 'migrate' && <MigrationWorkspace />}
    {page === 'guides' && <Guides />}
    {page === 'safety' && <Safety />}
    <Footer />
  </div>
}

export default App
