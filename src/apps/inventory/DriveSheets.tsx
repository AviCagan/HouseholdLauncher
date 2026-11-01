import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Sheet } from '@/components/primitives/Sheet'
import { Icon } from '@/components/primitives/Icon'
import { useProfile } from '@/store/useProfile'
import { fire } from '@/lib/haptics'
import { openExternal } from '@/apps/things/routing/deeplink'
import { importFolder } from './actions'
import { connectDrive, disconnectDrive, getScript, useDrive, type DriveFolder } from './drive'

/**
 * Connecting Google Drive, once, by an owner.
 *
 * Three steps and no Google Cloud console: copy a script, deploy it as a web
 * app from your own Google account, paste its address back. The script has
 * the household's secret in it already (see the inventory Edge Function), so
 * there is nothing to configure — and nothing anyone else's phone ever has
 * to sign in to.
 */
export function DriveSetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useDrive((s) => s.status)
  const setStatus = useDrive((s) => s.set)
  const [script, setScript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setUrl('')
    if (status?.connected) return
    void getScript().then((r) => (r.ok ? setScript(r.data.script) : setError(r.error)))
  }, [open, status?.connected])

  async function copy() {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
      fire('success')
      toast.success('Script copied')
    } catch {
      toast('Select the text and copy it by hand')
    }
  }

  async function connect() {
    setBusy(true)
    setError(null)
    const r = await connectDrive(url)
    setBusy(false)
    if (!r.ok) {
      fire('error')
      setError(r.error)
      return
    }
    fire('success')
    setStatus(r.data)
    toast.success('Google Drive is connected')
  }

  return (
    <Sheet open={open} onClose={onClose} height="92vh" title={<span className="inv-stencil text-[16px]">Google Drive</span>}>
      {status?.connected ? (
        <div className="flex flex-col gap-4 pb-4">
          <p className="text-[14px] leading-snug">
            Connected{status.account ? ` to ${status.account}'s Drive` : ''}. Every item is a folder in{' '}
            <b>Joint Stuff › Warranties, manuals, extra parts</b>.
          </p>
          <div className="flex flex-wrap gap-2">
            {status.root_url && (
              <button onClick={() => openExternal(status.root_url!)} className="inv-btn inv-btn--quiet">
                <Icon name="link" size={14} /> Open the folder
              </button>
            )}
            <button
              onClick={async () => {
                const r = await disconnectDrive()
                if (r.ok) setStatus(r.data)
              }}
              className="inv-btn inv-btn--quiet ml-auto"
            >
              Disconnect
            </button>
          </div>
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Disconnecting stops the app adding or showing files. Nothing in Drive is touched, and connecting again picks up where it left off.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-5 pb-6">
          <Step n={1} title="Copy the script">
            <p>It runs as you, in your Drive, and only does what Inventory asks of it — inside the Warranties folder and nowhere else.</p>
            {script ? (
              <>
                <textarea readOnly value={script} rows={5} aria-label="Script" className="inv-field mt-2 font-mono !text-[11px] leading-snug" onFocus={(e) => e.target.select()} />
                <button onClick={() => void copy()} className="inv-btn mt-2">
                  <Icon name="copy" size={14} /> Copy script
                </button>
              </>
            ) : (
              <p className="mt-2 font-semibold" style={{ color: error ? 'var(--inv-bad)' : 'var(--text-faint)' }}>
                {error ?? 'Getting it…'}
              </p>
            )}
          </Step>

          <Step n={2} title="Make it a web app">
            <p>
              Open{' '}
              <button onClick={() => openExternal('https://script.google.com/home/projects/create')} className="font-bold underline">
                a new Apps Script project
              </button>{' '}
              signed in as whoever owns the Joint Stuff folder. Delete what's there, paste, and save.
            </p>
            <p className="mt-1.5">
              Then <b>Deploy → New deployment</b>, pick <b>Web app</b>, and set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>. Deploy, and when Google asks, allow it to use your
              Drive (it will say the app isn't verified — it's your own script, so <b>Advanced → Go to…</b>).
            </p>
          </Step>

          <Step n={3} title="Paste the Web app URL">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/…/exec"
              aria-label="Web app URL"
              className="inv-field mt-1 font-mono !text-[12.5px]"
              spellCheck={false}
              autoCapitalize="off"
            />
            {error && script && (
              <p className="mt-1.5 font-semibold" style={{ color: 'var(--inv-bad)' }}>
                {error}
              </p>
            )}
            <button onClick={() => void connect()} disabled={!url.trim() || busy} className="inv-btn inv-btn--orange mt-2">
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </Step>
        </ol>
      )}
    </Sheet>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-black" style={{ background: 'var(--inv-yellow)', color: '#1d1b18' }}>
        {n}
      </span>
      <div className="min-w-0 flex-1 text-[13.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
        <h3 className="pb-1 text-[15px] font-extrabold" style={{ color: 'var(--text)' }}>
          {title}
        </h3>
        {children}
      </div>
    </li>
  )
}

/**
 * Folders made in Drive by hand, brought in as items — the cooler was the
 * first. Each one keeps its folder; the app reads what's in it.
 */
export function ImportSheet({ open, onClose, folders, onImported }: { open: boolean; onClose: () => void; folders: DriveFolder[]; onImported: (id: string) => void }) {
  const profileId = useProfile((s) => s.profileId)
  const [working, setWorking] = useState<string | null>(null)

  async function bring(folder: DriveFolder) {
    setWorking(folder.id)
    try {
      const row = await importFolder(folder, profileId)
      fire('success')
      if (row) toast.success(`${folder.name} is on the shelf`)
      return row
    } catch (err) {
      fire('error')
      toast.error(`Couldn't bring in ${folder.name}`, { description: err instanceof Error ? err.message : String(err) })
      return null
    } finally {
      setWorking(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={<span className="inv-stencil text-[16px]">Already in Drive</span>}>
      <div className="flex flex-col gap-3 pb-4">
        <p className="text-[13.5px] leading-snug" style={{ color: 'var(--text-dim)' }}>
          These folders are in Warranties, manuals, extra parts but not in Inventory yet. Bringing one in sorts its photos into the item, its parts and its paperwork, and reads its
          doc into the notes — have a look over each afterwards.
        </p>
        {folders.length === 0 && (
          <p className="py-6 text-center text-[13px]" style={{ color: 'var(--text-faint)' }}>
            Everything in the folder is already here.
          </p>
        )}
        {folders.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--inv-box-edge)' }}>
              <Icon name="box" size={22} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold">{f.name}</span>
            <button
              onClick={async () => {
                const row = await bring(f)
                if (row && folders.length === 1) onImported(row.id)
              }}
              disabled={working !== null}
              className="inv-btn !px-3 !py-1.5 !text-[12.5px]"
            >
              {working === f.id ? 'Bringing in…' : 'Bring in'}
            </button>
          </div>
        ))}
        {folders.length > 1 && (
          <button
            onClick={async () => {
              for (const f of folders) await bring(f)
            }}
            disabled={working !== null}
            className="inv-btn inv-btn--orange"
          >
            Bring in all {folders.length}
          </button>
        )}
      </div>
    </Sheet>
  )
}
