import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { supabase } from './lib/supabase'

type TenantChatMessage = {
  id: string
  sender_name: string
  sender_unit: string
  sender_role: 'tenant' | 'landlord'
  body: string
  created_at: string
}

type TenantChatIdentity = {
  email: string
  portalCode: string
}

type TenantGroupChatProps = {
  property: string
  variant: 'tenant' | 'landlord'
  tenantIdentity?: TenantChatIdentity
  ownerId?: string | null
}

export function TenantGroupChat({ property, variant, tenantIdentity, ownerId }: TenantGroupChatProps) {
  const [messages, setMessages] = useState<TenantChatMessage[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const isTenant = variant === 'tenant'
  const tenantEmail = tenantIdentity?.email
  const tenantPortalCode = tenantIdentity?.portalCode

  const loadMessages = useCallback(async () => {
    if (!supabase) {
      setError('Tenant chat requires a configured Supabase connection.')
      setLoading(false)
      return
    }
    if (isTenant && (!tenantEmail || !tenantPortalCode)) {
      setError('Sign in with your tenant portal code to open the group chat.')
      setLoading(false)
      return
    }
    if (!isTenant && !ownerId) {
      setError('The landlord workspace is not available for this account.')
      setLoading(false)
      return
    }

    try {
      const { data, error: queryError } = await supabase.rpc('tenant_group_chat_read', {
        p_owner_id: isTenant ? null : ownerId,
        p_property_name: property,
        p_email: isTenant ? tenantEmail : null,
        p_portal_code: isTenant ? tenantPortalCode : null,
      })
      if (queryError) {
        setError(`Could not load the property group chat: ${queryError.message}`)
      } else {
        setError('')
        setMessages((data ?? []) as TenantChatMessage[])
      }
    } catch (queryError) {
      setError(`Could not load the property group chat: ${queryError instanceof Error ? queryError.message : 'Unexpected request failure.'}`)
    } finally {
      setLoading(false)
    }
  }, [isTenant, ownerId, property, tenantEmail, tenantPortalCode])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadMessages(), 0)
    const timer = window.setInterval(() => void loadMessages(), 6000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [loadMessages])

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = message.trim()
    if (!body || sending) return
    if (!supabase) {
      setError('Tenant chat requires a configured Supabase connection.')
      return
    }

    setSending(true)
    setError('')
    setNotice('')
    try {
      const { error: sendError } = await supabase.rpc('tenant_group_chat_send', {
        p_owner_id: isTenant ? null : ownerId,
        p_property_name: property,
        p_body: body,
        p_email: isTenant ? tenantEmail : null,
        p_portal_code: isTenant ? tenantPortalCode : null,
      })
      if (sendError) {
        setError(`Could not send your message: ${sendError.message}`)
        return
      }
      setMessage('')
      setNotice('Message sent.')
      await loadMessages()
    } catch (sendError) {
      setError(`Could not send your message: ${sendError instanceof Error ? sendError.message : 'Unexpected request failure.'}`)
    } finally {
      setSending(false)
    }
  }

  return <section className="tenant-group-chat panel" aria-label={`${property} tenant group chat`}>
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{isTenant ? 'Resident community' : 'Tenant communication'}</p>
        <h2><MessageCircle size={19} aria-hidden="true" /> {property} group chat</h2>
        <p>{isTenant ? 'Share property issues and updates with your neighbours and landlord.' : 'Join the property conversation as the landlord or property team.'}</p>
      </div>
      <span className="live-badge">Landlord included</span>
    </div>

    {error && <p className="tenant-chat-feedback error" role="alert">{error}</p>}
    {notice && <p className="tenant-chat-feedback" role="status">{notice}</p>}
    <div className="tenant-chat-messages" role="region" aria-label={`${property} group chat messages`} tabIndex={0} aria-live="polite" aria-busy={loading}>
      {loading ? <p className="overview-empty">Loading group messages…</p>
        : messages.length === 0 ? <p className="overview-empty">No messages yet. Start the conversation about an issue or property update.</p>
          : messages.map(item => <article className={`tenant-chat-message ${item.sender_role === 'landlord' ? 'from-landlord' : ''}`} key={item.id}>
            <div className="tenant-chat-message-heading">
              <strong>{item.sender_name}</strong>
              <span className={`tenant-chat-role ${item.sender_role}`}>{item.sender_role === 'landlord' ? 'Landlord' : 'Tenant'}</span>
              {item.sender_role === 'tenant' && item.sender_unit && <small>Unit {item.sender_unit}</small>}
              <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </div>
            <p>{item.body}</p>
          </article>)}
    </div>
    <form className="tenant-chat-composer" onSubmit={sendMessage}>
      <label className="sr-only" htmlFor={`tenant-chat-message-${variant}-${property.replace(/[^a-zA-Z0-9]/g, '-')}`}>Write a message</label>
      <textarea
        id={`tenant-chat-message-${variant}-${property.replace(/[^a-zA-Z0-9]/g, '-')}`}
        value={message}
        onChange={event => setMessage(event.target.value)}
        maxLength={1000}
        placeholder={isTenant ? 'Describe the issue or reply to your neighbours…' : 'Reply to tenants or post a property update…'}
        rows={2}
        required
      />
      <button className="primary-button" type="submit" disabled={sending || !message.trim()}>
        <Send size={15} aria-hidden="true" /> {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
    <small className="tenant-chat-guidance">Messages are shared with residents of this property and the landlord. Please do not post private or emergency information.</small>
  </section>
}
