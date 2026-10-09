import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, ClipboardList, Plus, X } from 'lucide-react'
import { supabase } from './lib/supabase'

type MaintenanceRequest = {
  id: string
  tenant_email: string
  tenant_name: string
  property_name: string
  unit_name: string
  issue_type: string
  description: string
  priority: 'Low' | 'Medium' | 'High'
  status: 'submitted' | 'approved' | 'rejected' | 'completed'
  tenant_responsible: boolean
  final_cost: number | null
  created_at: string
}

type TenantIdentity = { email: string; portalCode: string; property: string; unit: string }
type TenantForDeposit = { name: string; email?: string; property: string; unit: string; unitDisplayName?: string; securityDeposit?: string | number }
type TenantMaintenanceProps = {
  variant: 'tenant' | 'landlord'
  tenantIdentity?: TenantIdentity
  ownerId?: string | null
  property?: string
  tenants?: TenantForDeposit[]
}

const issueTypes = ['Plumbing', 'Electrical', 'Appliance', 'Pest control', 'Security', 'Common area', 'Other']
const priorityValues: MaintenanceRequest['priority'][] = ['Low', 'Medium', 'High']

function formatMoney(value: number) {
  return `KSh ${value.toLocaleString('en-KE')}`
}

function statusLabel(request: MaintenanceRequest) {
  if (request.status === 'submitted') return 'Awaiting landlord approval'
  if (request.status === 'rejected') return 'Declined'
  if (request.status === 'approved') return request.tenant_responsible ? 'Approved · cost assessed at completion' : 'Approved · landlord responsibility'
  return request.tenant_responsible ? `Completed · ${formatMoney(Number(request.final_cost) || 0)} to reconcile at move-out` : 'Completed · no tenant deduction'
}

export function TenantMaintenance({ variant, tenantIdentity, ownerId, property, tenants = [] }: TenantMaintenanceProps) {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([])
  const [requestPage, setRequestPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [issueType, setIssueType] = useState(issueTypes[0])
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<MaintenanceRequest['priority']>('Medium')
  const [submitting, setSubmitting] = useState(false)
  const [activeRequest, setActiveRequest] = useState('')
  const [tenantResponsible, setTenantResponsible] = useState<Record<string, boolean>>({})
  const [completionCosts, setCompletionCosts] = useState<Record<string, string>>({})
  const isTenant = variant === 'tenant'
  const identityEmail = tenantIdentity?.email
  const identityCode = tenantIdentity?.portalCode
  const identityProperty = tenantIdentity?.property
  const identityUnit = tenantIdentity?.unit

  const loadRequests = useCallback(async () => {
    if (!supabase) {
      setError('Maintenance requests require a configured Supabase connection.')
      setLoading(false)
      return
    }
    if (isTenant && (!identityEmail || !identityCode)) {
      setError('Sign in to the tenant portal to view or submit maintenance requests.')
      setLoading(false)
      return
    }
    if (!isTenant && !ownerId) {
      setError('The landlord workspace is not available for this account.')
      setLoading(false)
      return
    }
    try {
      const { data, error: queryError } = await supabase.rpc('tenant_maintenance_list', {
        p_owner_id: isTenant ? null : ownerId,
        p_property_name: isTenant ? null : property ?? null,
        p_email: isTenant ? identityEmail : null,
        p_portal_code: isTenant ? identityCode : null,
        p_tenant_property: isTenant ? identityProperty : null,
        p_unit_name: isTenant ? identityUnit : null,
      })
      if (queryError) setError(`Could not load maintenance requests: ${queryError.message}`)
      else {
        setError('')
        setRequests((data ?? []) as MaintenanceRequest[])
      }
    } catch (queryError) {
      setError(`Could not load maintenance requests: ${queryError instanceof Error ? queryError.message : 'Unexpected request failure.'}`)
    } finally {
      setLoading(false)
    }
  }, [identityCode, identityEmail, identityProperty, identityUnit, isTenant, ownerId, property])

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadRequests(), 0)
    const refreshTimer = window.setInterval(() => void loadRequests(), 15000)
    return () => {
      window.clearTimeout(firstLoad)
      window.clearInterval(refreshTimer)
    }
  }, [loadRequests])

  const tenantDeductions = useMemo(() => {
    const totals = new Map<string, number>()
    for (const request of requests) {
      if (request.status !== 'completed' || !request.tenant_responsible) continue
      const key = `${request.tenant_email.trim().toLowerCase()}|${request.property_name}|${request.unit_name}`
      totals.set(key, (totals.get(key) ?? 0) + (Number(request.final_cost) || 0))
    }
    return totals
  }, [requests])
  const requestPageSize = 8
  const requestPageCount = Math.max(1, Math.ceil(requests.length / requestPageSize))
  const currentRequestPage = Math.min(requestPage, requestPageCount)
  const visibleRequests = requests.slice((currentRequestPage - 1) * requestPageSize, currentRequestPage * requestPageSize)

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || submitting) return
    setSubmitting(true)
    setError('')
    setNotice('')
    try {
      const { error: submitError } = await supabase.rpc('tenant_maintenance_create', {
        p_email: identityEmail,
        p_portal_code: identityCode,
        p_property_name: identityProperty,
        p_unit_name: identityUnit,
        p_issue_type: issueType,
        p_description: description.trim(),
        p_priority: priority,
      })
      if (submitError) {
        setError(`Could not submit maintenance request: ${submitError.message}`)
        return
      }
      setDescription('')
      setRequestPage(1)
      setNotice('Request submitted. Your landlord will review it.')
      await loadRequests()
    } catch (submitError) {
      setError(`Could not submit maintenance request: ${submitError instanceof Error ? submitError.message : 'Unexpected request failure.'}`)
    } finally {
      setSubmitting(false)
    }
  }

  const reviewRequest = async (request: MaintenanceRequest, decision: 'approved' | 'rejected') => {
    if (!supabase) return
    setActiveRequest(request.id)
    setError('')
    setNotice('')
    try {
      const { error: reviewError } = await supabase.rpc('tenant_maintenance_review', {
        p_request_id: request.id,
        p_decision: decision,
        p_tenant_responsible: decision === 'approved' ? Boolean(tenantResponsible[request.id]) : false,
      })
      if (reviewError) setError(`Could not ${decision === 'approved' ? 'approve' : 'decline'} request: ${reviewError.message}`)
      else {
        setNotice(decision === 'approved' ? 'Request approved.' : 'Request declined.')
        await loadRequests()
      }
    } catch (reviewError) {
      setError(`Could not ${decision === 'approved' ? 'approve' : 'decline'} request: ${reviewError instanceof Error ? reviewError.message : 'Unexpected request failure.'}`)
    } finally {
      setActiveRequest('')
    }
  }

  const completeRequest = async (request: MaintenanceRequest) => {
    if (!supabase) return
    const finalCost = Number(completionCosts[request.id])
    if (!Number.isFinite(finalCost) || finalCost < 0) {
      setError('Enter a valid final maintenance cost. Enter 0 if there was no cost.')
      return
    }
    setActiveRequest(request.id)
    setError('')
    setNotice('')
    try {
      const { error: completeError } = await supabase.rpc('tenant_maintenance_complete', {
        p_request_id: request.id,
        p_final_cost: finalCost,
      })
      if (completeError) setError(`Could not complete request: ${completeError.message}`)
      else {
        setNotice(request.tenant_responsible ? 'Request completed and the confirmed tenant-responsible cost was added to the move-out deposit ledger.' : 'Request completed. No tenant deposit deduction was recorded.')
        await loadRequests()
      }
    } catch (completeError) {
      setError(`Could not complete request: ${completeError instanceof Error ? completeError.message : 'Unexpected request failure.'}`)
    } finally {
      setActiveRequest('')
    }
  }

  const completedTenantCharges = requests.filter(request => request.status === 'completed' && request.tenant_responsible)
  const totalPendingDepositDeductions = completedTenantCharges.reduce((sum, request) => sum + (Number(request.final_cost) || 0), 0)

  return <section className="tenant-maintenance panel" aria-label={isTenant ? 'My maintenance requests' : 'Tenant maintenance approvals'}>
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{isTenant ? 'Resident support' : 'Review tenant requests'}</p>
        <h2><ClipboardList size={19} aria-hidden="true" /> {isTenant ? 'Maintenance requests' : 'Tenant maintenance & deposit ledger'}</h2>
        <p>{isTenant ? 'Report a property issue. Your landlord will review it before work is approved.' : 'Only confirmed tenant-responsible costs are recorded for deposit reconciliation at move-out.'}</p>
      </div>
      {!isTenant && <span className="live-badge">{requests.filter(request => request.status === 'submitted').length} awaiting approval</span>}
    </div>

    {error && <p className="tenant-maintenance-feedback error" role="alert">{error}</p>}
    {notice && <p className="tenant-maintenance-feedback" role="status">{notice}</p>}

    {isTenant ? <form className="tenant-maintenance-form" onSubmit={submitRequest}>
      <label><span>Issue type</span><select value={issueType} onChange={event => setIssueType(event.target.value)}>{issueTypes.map(type => <option key={type}>{type}</option>)}</select></label>
      <label><span>Priority</span><select value={priority} onChange={event => setPriority(event.target.value as MaintenanceRequest['priority'])}>{priorityValues.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="tenant-maintenance-description"><span>Describe the issue</span><textarea required minLength={5} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What is broken or needs attention? Include where it is if relevant." rows={3} /></label>
      <button className="primary-button" type="submit" disabled={submitting || description.trim().length < 5}><Plus size={15} /> {submitting ? 'Submitting…' : 'Submit request'}</button>
    </form> : <div className="tenant-deposit-ledger">
      <h3>Move-out deposit reconciliation</h3>
      <p>Ordinary repairs and normal wear remain landlord responsibility. Tenant charges are listed only after you mark a request tenant-responsible and enter its final cost.</p>
      {tenants.filter(tenant => !property || tenant.property === property).map(tenant => {
        const key = `${(tenant.email ?? '').trim().toLowerCase()}|${tenant.property}|${tenant.unitDisplayName || tenant.unit}`
        const deductions = tenantDeductions.get(key) ?? 0
        const hasDeposit = tenant.securityDeposit !== undefined && tenant.securityDeposit !== ''
        const deposit = Number(String(tenant.securityDeposit ?? '').replace(/[^0-9.]/g, '')) || 0
        return <div className="tenant-deposit-row" key={`${tenant.property}-${tenant.unit}-${tenant.email ?? tenant.name}`}>
          <span><strong>{tenant.name}</strong><small>{tenant.property} · Unit {tenant.unitDisplayName || tenant.unit}</small></span>
          <span><strong>{hasDeposit ? formatMoney(deposit) : 'Not recorded'}</strong><small>Deposit held</small></span>
          <span><strong>{formatMoney(deductions)}</strong><small>Tenant-responsible costs to reconcile</small></span>
          <span><strong>{hasDeposit ? formatMoney(Math.max(deposit - deductions, 0)) : 'Not available'}</strong><small>{hasDeposit && deductions > deposit ? `Deposit shortfall: ${formatMoney(deductions - deposit)}` : 'Estimated deposit balance'}</small></span>
        </div>
      })}
      {!tenants.length && <p className="overview-empty">No tenant deposit records are available.</p>}
      {totalPendingDepositDeductions > 0 && <small className="tenant-deposit-total">Total tenant-responsible costs recorded: {formatMoney(totalPendingDepositDeductions)}. Reconcile against actual deposit at move-out.</small>}
    </div>}

    <div className="tenant-maintenance-list">
      {loading ? <p className="overview-empty">Loading maintenance requests…</p>
        : requests.length === 0 ? <p className="overview-empty">{isTenant ? 'You have not submitted any maintenance requests yet.' : 'No tenant maintenance requests have been submitted.'}</p>
          : visibleRequests.map(request => <article className={`tenant-maintenance-request status-${request.status}`} key={request.id}>
            <div className="tenant-maintenance-request-heading">
              <div><strong>{request.issue_type}</strong><span className={`tenant-maintenance-status ${request.status}`}>{statusLabel(request)}</span></div>
              <time dateTime={request.created_at}>{new Date(request.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</time>
            </div>
            <p>{request.description}</p>
            <div className="tenant-maintenance-request-details">
              <span>{request.property_name} · Unit {request.unit_name}{isTenant ? '' : ` · ${request.tenant_name}`}</span>
              <span className={`tenant-maintenance-priority priority-${request.priority.toLowerCase()}`}>{request.priority} priority</span>
            </div>
            {!isTenant && request.status === 'submitted' && <div className="tenant-maintenance-review">
              <label><input type="checkbox" checked={Boolean(tenantResponsible[request.id])} onChange={event => setTenantResponsible(current => ({ ...current, [request.id]: event.target.checked }))} /><span>Tenant-responsible damage (confirm only if evidence supports a tenant charge)</span></label>
              <button type="button" className="filter-button" disabled={activeRequest === request.id} onClick={() => void reviewRequest(request, 'rejected')}><X size={14} /> Decline</button>
              <button type="button" className="primary-button" disabled={activeRequest === request.id} onClick={() => void reviewRequest(request, 'approved')}><Check size={14} /> Approve</button>
            </div>}
            {!isTenant && request.status === 'approved' && <form className="tenant-maintenance-complete" onSubmit={event => { event.preventDefault(); void completeRequest(request) }}>
              <label><span>Final cost (KSh){request.tenant_responsible ? ' · reconciled against deposit at move-out' : ''}</span><input type="number" min="0" step="0.01" required value={completionCosts[request.id] ?? ''} onChange={event => setCompletionCosts(current => ({ ...current, [request.id]: event.target.value }))} placeholder="Enter final cost" /></label>
              <button type="submit" className="primary-button" disabled={activeRequest === request.id}>{activeRequest === request.id ? 'Saving…' : 'Mark completed'}</button>
            </form>}
            {request.status === 'completed' && <small className="tenant-maintenance-final-cost">Final cost: {formatMoney(Number(request.final_cost) || 0)} · {request.tenant_responsible ? 'Recorded for deposit reconciliation at move-out' : 'No tenant deduction'}</small>}
          </article>)}
    </div>
    {!loading && requests.length > requestPageSize && <nav className="tenant-maintenance-pagination" aria-label="Maintenance request pages">
      <span>Showing {(currentRequestPage - 1) * requestPageSize + 1}–{Math.min(currentRequestPage * requestPageSize, requests.length)} of {requests.length} requests</span>
      <div>
        <button type="button" disabled={currentRequestPage === 1} onClick={() => setRequestPage(currentRequestPage - 1)}>Previous</button>
        <strong>Page {currentRequestPage} of {requestPageCount}</strong>
        <button type="button" disabled={currentRequestPage === requestPageCount} onClick={() => setRequestPage(currentRequestPage + 1)}>Next</button>
      </div>
    </nav>}
  </section>
}
