import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Bell, CalendarDays, Check, Clock3, FileText, MapPin, X } from 'lucide-react'
import { supabase } from './lib/supabase'

type TenantNoticeRecord = {
  id: string
  tenant_email: string
  tenant_name: string
  property_name: string
  unit_name: string
  intended_move_out_date: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
}

type TenantNoticeIdentity = { email: string; portalCode: string; property: string; unit: string }
type TenantNoticesProps = {
  variant: 'tenant' | 'landlord'
  tenantIdentity?: TenantNoticeIdentity
  ownerId?: string | null
  canReview?: boolean
}

const pageSize = 8
const minimumMoveOutDate = (() => {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0')
  const day = String(tomorrow.getDate()).padStart(2, '0')
  return `${tomorrow.getFullYear()}-${month}-${day}`
})()

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function TenantNotices({ variant, tenantIdentity, ownerId, canReview = false }: TenantNoticesProps) {
  const [notices, setNotices] = useState<TenantNoticeRecord[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [activeNotice, setActiveNotice] = useState('')
  const [moveOutDate, setMoveOutDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const isTenant = variant === 'tenant'
  const email = tenantIdentity?.email
  const portalCode = tenantIdentity?.portalCode
  const tenantProperty = tenantIdentity?.property
  const unitName = tenantIdentity?.unit

  const loadNotices = useCallback(async () => {
    if (!supabase) {
      setError('Notices require a configured Supabase connection.')
      setLoading(false)
      return
    }
    if (isTenant && (!email || !portalCode || !tenantProperty || !unitName)) {
      setError('Sign in to the tenant portal to view or apply for a notice.')
      setLoading(false)
      return
    }
    if (!isTenant && !ownerId) {
      setError('The landlord workspace is not available for this account.')
      setLoading(false)
      return
    }

    try {
      const { data, error: queryError } = await supabase.rpc('tenant_notice_list', {
        p_owner_id: isTenant ? null : ownerId,
        p_email: isTenant ? email : null,
        p_portal_code: isTenant ? portalCode : null,
        p_tenant_property: isTenant ? tenantProperty : null,
        p_unit_name: isTenant ? unitName : null,
      })
      if (queryError) setError(`Could not load notices: ${queryError.message}`)
      else {
        setError('')
        setNotices((data ?? []) as TenantNoticeRecord[])
      }
    } catch (queryError) {
      setError(`Could not load notices: ${queryError instanceof Error ? queryError.message : 'Unexpected request failure.'}`)
    } finally {
      setLoading(false)
    }
  }, [email, isTenant, ownerId, portalCode, tenantProperty, unitName])

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadNotices(), 0)
    const refreshTimer = window.setInterval(() => void loadNotices(), 15000)
    return () => {
      window.clearTimeout(firstLoad)
      window.clearInterval(refreshTimer)
    }
  }, [loadNotices])

  const pageCount = Math.max(1, Math.ceil(notices.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleNotices = notices.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const pendingTenantNotice = isTenant && notices.some(notice => notice.status === 'pending')

  const submitNotice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || submitting) return
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const { error: submitError } = await supabase.rpc('tenant_notice_create', {
        p_email: email,
        p_portal_code: portalCode,
        p_property_name: tenantProperty,
        p_unit_name: unitName,
        p_move_out_date: moveOutDate,
        p_reason: reason.trim(),
      })
      if (submitError) {
        setError(`Could not submit your notice: ${submitError.message}`)
        return
      }
      setMoveOutDate('')
      setReason('')
      setPage(1)
      setMessage('Notice submitted. Your landlord will review it.')
      await loadNotices()
    } catch (submitError) {
      setError(`Could not submit your notice: ${submitError instanceof Error ? submitError.message : 'Unexpected request failure.'}`)
    } finally {
      setSubmitting(false)
    }
  }

  const reviewNotice = async (notice: TenantNoticeRecord, decision: 'approved' | 'rejected') => {
    if (!supabase || !canReview) return
    setActiveNotice(notice.id)
    setError('')
    setMessage('')
    try {
      const { error: reviewError } = await supabase.rpc('tenant_notice_review', {
        p_notice_id: notice.id,
        p_decision: decision,
      })
      if (reviewError) setError(`Could not ${decision === 'approved' ? 'approve' : 'decline'} notice: ${reviewError.message}`)
      else {
        setMessage(decision === 'approved' ? 'Notice approved.' : 'Notice declined.')
        await loadNotices()
      }
    } catch (reviewError) {
      setError(`Could not ${decision === 'approved' ? 'approve' : 'decline'} notice: ${reviewError instanceof Error ? reviewError.message : 'Unexpected request failure.'}`)
    } finally {
      setActiveNotice('')
    }
  }

  return <section className={`tenant-notices tenant-notices-${variant} panel`} aria-label={isTenant ? 'Notice to vacate' : 'Tenant notice approvals'}>
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{isTenant ? 'Move-out request' : 'Resident notices'}</p>
        <h2><Bell size={19} aria-hidden="true" /> {isTenant ? 'Notice to vacate' : 'Tenant notices'}</h2>
        <p>{isTenant ? 'Submit your intended move-out date for landlord approval.' : 'Review tenant move-out dates and approve or decline each notice.'}</p>
      </div>
      {!isTenant && <span className="live-badge">{notices.filter(notice => notice.status === 'pending').length} awaiting review</span>}
    </div>

    {error && <p className="tenant-notice-feedback error" role="alert">{error}</p>}
    {message && <p className="tenant-notice-feedback" role="status">{message}</p>}

    {isTenant && pendingTenantNotice && <p className="tenant-notice-pending-note">Your notice is awaiting landlord approval. You can submit another after it has been reviewed.</p>}
    {isTenant && <form className="tenant-notice-form" onSubmit={submitNotice}>
      <label><span>Intended move-out date</span><input type="date" required disabled={pendingTenantNotice} min={minimumMoveOutDate} value={moveOutDate} onChange={event => setMoveOutDate(event.target.value)} /></label>
      <label className="tenant-notice-reason"><span>Reason (optional)</span><textarea maxLength={1000} rows={3} disabled={pendingTenantNotice} value={reason} onChange={event => setReason(event.target.value)} placeholder="Add a note for your landlord, if you wish." /></label>
      <button type="submit" className="primary-button" disabled={submitting || pendingTenantNotice || !moveOutDate}><FileText size={15} /> {submitting ? 'Submitting…' : 'Submit notice'}</button>
    </form>}

    <div className="tenant-notice-list" aria-live="polite">
      {loading ? <p className="overview-empty">Loading notices…</p>
        : error ? null
          : notices.length === 0 ? <p className="overview-empty">{isTenant ? 'You have not submitted a notice to vacate.' : 'There are no tenant notices to review.'}</p>
          : visibleNotices.map(notice => <article className="tenant-notice-card" key={notice.id}>
            <div className="tenant-notice-card-heading">
              <div className="tenant-notice-identity"><strong>{notice.tenant_name}</strong><span className={`tenant-notice-status ${notice.status}`}>{notice.status === 'pending' ? 'Awaiting approval' : notice.status === 'approved' ? 'Approved' : 'Declined'}</span></div>
              <time dateTime={notice.created_at}><Clock3 size={13} aria-hidden="true" /> Submitted {new Date(notice.created_at).toLocaleDateString('en-KE', { dateStyle: 'medium' })}</time>
            </div>
            <div className="tenant-notice-details">
              {!isTenant && <div className="tenant-notice-detail location"><span><MapPin size={14} aria-hidden="true" /> Property and unit</span><strong>{notice.property_name} · Unit {notice.unit_name}</strong></div>}
              <div className="tenant-notice-detail move-out"><span><CalendarDays size={14} aria-hidden="true" /> Intended move-out</span><strong>{formatDate(notice.intended_move_out_date)}</strong></div>
            </div>
            {notice.reason && <p className="tenant-notice-reason-text"><span>Tenant's note</span>{notice.reason}</p>}
            {!isTenant && notice.status === 'pending' && canReview && <div className="tenant-notice-actions">
              <button type="button" className="filter-button" disabled={activeNotice === notice.id} onClick={() => void reviewNotice(notice, 'rejected')}><X size={14} /> Decline</button>
              <button type="button" className="primary-button" disabled={activeNotice === notice.id} onClick={() => void reviewNotice(notice, 'approved')}><Check size={14} /> Approve</button>
            </div>}
          </article>)}
    </div>

    {!loading && notices.length > pageSize && <nav className="tenant-notice-pagination" aria-label="Notice pages">
      <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, notices.length)} of {notices.length} notices</span>
      <div>
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <strong>Page {currentPage} of {pageCount}</strong>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>
    </nav>}
  </section>
}
