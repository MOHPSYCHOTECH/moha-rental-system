import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BellRing, Building2, CheckCircle2, Send, Smartphone, Users, Wrench } from 'lucide-react'
import { supabase } from './lib/supabase'

type AppRole = 'landlord' | 'caretaker' | 'tenant'
type Campaign = {
  id: string
  title: string
  body: string
  recipient_roles: AppRole[]
  status: 'sent' | 'partial' | 'failed'
  sent_count: number
  failed_count: number
  created_at: string
}

const historyPageSize = 5

const recipientLabels: Record<AppRole, string> = {
  landlord: 'Landlords',
  caretaker: 'Caretakers',
  tenant: 'Tenants',
}

const recipientDescriptions: Record<AppRole, string> = {
  landlord: 'Property owners',
  caretaker: 'Property teams',
  tenant: 'Residents',
}

const recipientIcons = {
  landlord: Building2,
  caretaker: Wrench,
  tenant: Users,
}

export function PlatformPushNotifications() {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [roles, setRoles] = useState<AppRole[]>(['landlord', 'caretaker', 'tenant'])
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [historyLoading, setHistoryLoading] = useState(Boolean(supabase))
  const [historyError, setHistoryError] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [historyCount, setHistoryCount] = useState(0)
  const [historyRefresh, setHistoryRefresh] = useState(0)

  useEffect(() => {
    if (!supabase) {
      return
    }
    let active = true
    void (async () => {
      try {
        const { data, count, error } = await supabase.from('app_push_campaigns')
          .select('id, title, body, recipient_roles, status, sent_count, failed_count, created_at', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range((historyPage - 1) * historyPageSize, historyPage * historyPageSize - 1)
        if (!active) return
        if (error) setHistoryError(`Notification history could not be loaded: ${error.message}. Run supabase/app_push_notifications.sql.`)
        else {
          setHistoryError('')
          setCampaigns((data ?? []) as Campaign[])
          setHistoryCount(count ?? 0)
        }
      } catch (error) {
        if (active) setHistoryError(`Notification history could not be loaded: ${error instanceof Error ? error.message : 'Unexpected error.'}`)
      } finally {
        if (active) setHistoryLoading(false)
      }
    })()
    return () => { active = false }
  }, [historyPage, historyRefresh])

  const toggleRole = (role: AppRole) => {
    setRoles(current => current.includes(role)
      ? current.filter(item => item !== role)
      : [...current, role])
  }

  const sendNotification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) {
      setNotice({ kind: 'error', message: 'Supabase is not configured for this site.' })
      return
    }
    if (!roles.length) {
      setNotice({ kind: 'error', message: 'Select at least one recipient role.' })
      return
    }
    setSending(true)
    setNotice(null)
    try {
      const { data, error } = await supabase.functions.invoke('send-app-notification', {
        body: { title: title.trim(), message: message.trim(), roles },
      })
      if (error) {
        const context = 'context' in error ? error.context : undefined
        if (context instanceof Response) {
          let detail = error.message
          try {
            const payload = await context.clone().json() as { error?: unknown }
            if (typeof payload.error === 'string') detail = payload.error
          } catch {
            detail = error.message
          }
          throw new Error(detail)
        }
        throw new Error(error.message)
      }
      if (!data || typeof data.sent !== 'number' || typeof data.failed !== 'number') {
        throw new Error('The push service returned an incomplete delivery result.')
      }
      setNotice({
        kind: data.failed > 0 ? 'error' : 'success',
        message: `Sent to ${data.sent} device${data.sent === 1 ? '' : 's'}${data.failed ? `; ${data.failed} delivery${data.failed === 1 ? '' : 'ies'} failed` : ''}.`,
      })
      setTitle('')
      setMessage('')
      setHistoryLoading(true)
      setHistoryPage(1)
      setHistoryRefresh(current => current + 1)
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'The notification could not be sent.' })
    } finally {
      setSending(false)
    }
  }

  const changeHistoryPage = (page: number) => {
    setHistoryLoading(true)
    setHistoryPage(page)
  }

  return <section className="platform-push-page" aria-labelledby="platform-push-title">
    <div className="platform-push-heading">
      <span className="platform-push-icon"><BellRing size={22} /></span>
      <div>
        <p className="eyebrow">ANDROID APP MESSAGING</p>
        <h2 id="platform-push-title">Send a push notification</h2>
        <p>Send an announcement to installed landlord, caretaker, or tenant apps. Recipients must sign in and allow notifications on their device.</p>
      </div>
      <span className="platform-push-channel"><span /> Push channel active</span>
    </div>
    <div className="platform-push-workspace">
      <form className="platform-push-form" onSubmit={event => void sendNotification(event)}>
        <div className="platform-push-section-heading">
          <div><p className="eyebrow">NEW CAMPAIGN</p><h3>Compose message</h3></div>
          <span><Smartphone size={15} /> Android apps</span>
        </div>
        <fieldset className="platform-push-recipient-group">
          <legend>Choose recipients <small>{roles.length} of 3 selected</small></legend>
          <div className="platform-push-recipients">
            {(Object.keys(recipientLabels) as AppRole[]).map(role => {
              const RecipientIcon = recipientIcons[role]
              return <label key={role} className={`platform-push-recipient${roles.includes(role) ? ' selected' : ''}`}>
                <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
                <span className="platform-push-recipient-icon"><RecipientIcon size={18} /></span>
                <span className="platform-push-recipient-copy"><strong>{recipientLabels[role]}</strong><small>{recipientDescriptions[role]}</small></span>
                <CheckCircle2 className="platform-push-recipient-check" size={17} />
              </label>
            })}
          </div>
        </fieldset>
        <label className="form-field platform-push-title-field">
          <span>Notification title <small>Required</small></span>
          <input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Important rent payment update" />
        </label>
        <label className="form-field platform-push-message-field">
          <span>Message <small>Required</small></span>
          <textarea required maxLength={500} rows={4} value={message} onChange={event => setMessage(event.target.value)} placeholder="Write a clear message for your app users." />
          <small className="platform-push-character-count">{message.length}/500 characters</small>
        </label>
        {notice && <p className={`platform-push-feedback ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
        <div className="platform-push-form-footer">
          <p>Messages will be sent to signed-in users who have allowed notifications.</p>
          <button className="primary-button platform-push-submit" type="submit" disabled={sending || !roles.length}>
            <Send size={16} />{sending ? 'Sending…' : 'Send notification'}
          </button>
        </div>
      </form>
      <aside className="platform-push-guidance">
        <span className="platform-push-guidance-icon"><BellRing size={19} /></span>
        <p className="eyebrow">DELIVERY CHECKLIST</p>
        <h3>Reach the right people</h3>
        <p>Select one or more app groups. Only active accounts with a registered device can receive a push.</p>
        <div className="platform-push-guidance-item"><CheckCircle2 size={16} /><span>Choose the recipient roles</span></div>
        <div className="platform-push-guidance-item"><CheckCircle2 size={16} /><span>Write a short, clear update</span></div>
        <div className="platform-push-guidance-item"><CheckCircle2 size={16} /><span>Recipients must enable notifications</span></div>
        <div className="platform-push-guidance-note"><Smartphone size={16} /><span>Delivery status reflects devices reached by Firebase, not whether the message was opened.</span></div>
      </aside>
    </div>
    <section className="platform-push-history" aria-labelledby="platform-push-history-title">
      <div className="platform-push-history-heading">
        <div><p className="eyebrow">DELIVERY LOG</p><h3 id="platform-push-history-title">Recent notifications</h3></div>
        <span>{historyCount} {historyCount === 1 ? 'campaign' : 'campaigns'}</span>
      </div>
      {!supabase ? <p className="settings-error" role="alert">Connect this app to Supabase to view sent notifications.</p>
        : historyLoading ? <p className="platform-push-empty">Loading notification history…</p>
        : historyError ? <p className="settings-error" role="alert">{historyError}</p>
          : campaigns.length === 0 ? <p className="platform-push-empty">No notifications have been sent yet.</p>
            : <div className="platform-push-campaigns">
              {campaigns.map(campaign => <article className="platform-push-campaign" key={campaign.id}>
                <span className="platform-push-campaign-icon"><BellRing size={17} /></span>
                <div className="platform-push-campaign-copy"><strong>{campaign.title}</strong><p>{campaign.body}</p><small>{campaign.recipient_roles.map(role => recipientLabels[role]).join(', ')} <span>·</span> {new Date(campaign.created_at).toLocaleString()}</small></div>
                <span className={`platform-push-status ${campaign.status}`}>{campaign.status === 'sent' ? 'Delivered' : campaign.status === 'partial' ? 'Partial' : 'Failed'} <small>{campaign.sent_count} sent{campaign.failed_count ? ` · ${campaign.failed_count} failed` : ''}</small></span>
              </article>)}
            </div>}
      {historyCount > historyPageSize && <nav className="platform-push-pagination" aria-label="Notification history pagination">
        <span>Showing {(historyPage - 1) * historyPageSize + 1}–{Math.min(historyPage * historyPageSize, historyCount)} of {historyCount}</span>
        <div>
          <button type="button" disabled={historyLoading || historyPage === 1} onClick={() => changeHistoryPage(historyPage - 1)}>Previous</button>
          <span>Page {historyPage} of {Math.ceil(historyCount / historyPageSize)}</span>
          <button type="button" disabled={historyLoading || historyPage >= Math.ceil(historyCount / historyPageSize)} onClick={() => changeHistoryPage(historyPage + 1)}>Next</button>
        </div>
      </nav>}
    </section>
  </section>
}
