import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowUpRight, Bell, Building2, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign, ClipboardList, Copy, Download, Droplets, FileText, Home, LayoutDashboard, LifeBuoy, LogIn, LogOut, Menu, MessageCircle, Moon, Pencil, Plus, ReceiptText, RefreshCw, Search, Settings, ShieldCheck, Sun, Trash2, TrendingUp, UserPlus, Users, UserX, WalletCards, Wrench } from 'lucide-react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type PropertyRecord = { name: string; address: string; units: number; occupied: number; income: string; status: string; color: string }
type TenantRecord = { name: string; unit: string; unitDisplayName?: string; unitType: string; property: string; rent: string; lease: string; leaseEnd?: string; movedIn?: string; rentAccountRef?: string; portalCode?: string; status: string; waterBill?: string; waterBillUpdatedAt?: string; email?: string; phone?: string; idNumber?: string }
type InvoiceRecord = { id: string; tenantName: string; email?: string; property: string; unit: string; unitType: string; rent: string; waterBill: string; issuedAt: string; movedIn?: string }
type RentPaymentRecord = { id: string; owner_id: string; account_reference: string; mpesa_receipt: string; amount: number; transacted_at: string; phone?: string; tenant_name: string; property_name: string; unit_name: string }
type LandlordPaymentMethod = 'paybill' | 'till' | 'bank_transfer'
type LandlordPaymentDetails = { method: LandlordPaymentMethod; paybillNumber: string; tillNumber: string; bankName: string; bankAccountName: string; bankAccountNumber: string }
const defaultLandlordPaymentDetails: LandlordPaymentDetails = { method: 'paybill', paybillNumber: '', tillNumber: '', bankName: '', bankAccountName: '', bankAccountNumber: '' }
type SubscriptionPaymentDetails = LandlordPaymentDetails
const defaultSubscriptionPaymentDetails: SubscriptionPaymentDetails = { ...defaultLandlordPaymentDetails }
const ConfirmedRentPaymentsContext = createContext<RentPaymentRecord[]>([])
const ConfirmedRentPaymentRefreshContext = createContext<{ refresh: () => Promise<void>; refreshing: boolean; error: string }>({ refresh: async () => {}, refreshing: false, error: '' })
const TenantDirectoryContext = createContext<TenantRecord[]>([])
const LandlordPaybillContext = createContext<LandlordPaymentDetails>(defaultLandlordPaymentDetails)
type UnitRecord = { unit: string; displayName?: string; type: string; tenant: string; status: string; rent: string }
type UnitMixRow = { type: string; count: string; rent: string }
type SubscriptionPlan = 'test' | 'silver_monthly' | 'silver_yearly' | 'monthly' | 'yearly' | 'none'
type SubscriptionRequestPlan = Exclude<SubscriptionPlan, 'test' | 'none'>
type PaidSubscriptionPlan = 'silver_monthly' | 'silver_yearly'
type PublicLandlordPlan = 'test' | PaidSubscriptionPlan
type LandlordSignupStatus = 'pending' | 'approved' | 'rejected'
type SubscriptionStatus = 'active' | 'expired' | 'trial' | 'none'
type CaretakerAssignment = { id: string; landlord_id: string; caretaker_id: string; property_name: string; unit_name: string; active: boolean; notes?: string | null }
type AccessUser = { id: string; name: string; username: string; userType: 'Platform Administrator' | 'Landlord' | 'Caretaker' | 'Property Manager'; role: 'Administrator' | 'Manager' | 'Caretaker' | 'Accountant' | 'Viewer'; active: boolean; email?: string; phone?: string; signupStatus?: LandlordSignupStatus; requestedPlan?: PublicLandlordPlan; managedProperties?: Array<{ property: string; unit: string }>; subscription?: { plan: SubscriptionPlan; status: SubscriptionStatus; startDate: string; expiryDate: string; amount: number }; subscriptionRequest?: { id?: string; plan: SubscriptionRequestPlan; amount: number; mpesaCode: string; paymentMethod?: LandlordPaymentMethod; submittedAt: string; status: 'pending' | 'approved' | 'rejected'; reviewedAt?: string } }
type PlatformAdminAccountRow = { user_id: string; display_name: string | null; email: string | null; phone: string | null; user_type: string; owner_id: string | null; signup_status: string | null; requested_plan: string | null; account_role: string; account_active: boolean }
type AdminSubscriptionPaymentQueueRow = { request_id: string; user_id: string; plan: SubscriptionRequestPlan; amount: number; mpesa_code: string; payment_method: LandlordPaymentMethod; status: 'pending'; submitted_at: string; reviewed_at: string | null; profile_name: string; profile_email: string | null; profile_phone: string | null; user_type: string; account_role: string; account_active: boolean }
type SubscriptionPaymentHistoryFilter = 'approved' | 'rejected' | 'all'
type PublicPlatformStats = { landlord_count: number; tenant_count: number; total_collected: number }
type SettingsSection = 'workspace' | 'rent-collection' | 'notifications' | 'account' | 'team-invites' | 'subscription-method' | 'landlord-approvals' | 'users' | 'subscription-payments' | 'workspace-history'
type AdminSubscriptionPaymentHistoryRow = Omit<AdminSubscriptionPaymentQueueRow, 'status'> & { status: 'approved' | 'rejected' }
type AdminSubscriptionPaymentHistoryResult = { total_count: number; requests: AdminSubscriptionPaymentHistoryRow[] }
type TenantPortalSession = { name: string; property: string; unit: string; email: string; portalCode: string }
type ExpenseRecord = { id: string; category: string; property: string; amount: number; date: string; note: string; paid?: boolean }
type ApplicantRecord = { id: string; name: string; phone: string; property: string; unit: string; stage: 'Viewing' | 'Applied' | 'Approved' | 'Moved in' }
type RentReminderChannel = 'WhatsApp' | 'Email'
type RentalWorkspaceSettings = { workspaceName: string; propertyGroup: string; darkMode: boolean; notifEmail: boolean; notifWeekly: boolean; rentReminderEnabled: boolean; rentReminderDays: number; rentReminderChannel: RentReminderChannel; landlordPaybill: string; landlordPaymentMethod: LandlordPaymentMethod; landlordTillNumber: string; landlordBankName: string; landlordBankAccountName: string; landlordBankAccountNumber: string }
type RentalWorkspaceData = { properties: PropertyRecord[]; units: Record<string, UnitRecord[]>; tenants: TenantRecord[]; records: Record<string, string[]>; invoices: InvoiceRecord[]; maintenance: Record<string, boolean>; expenses: ExpenseRecord[]; applicants: ApplicantRecord[]; settings?: RentalWorkspaceSettings }
type PlatformCaretakerAssignment = { caretakerId: string; caretakerName: string; caretakerEmail?: string; property: string; unit: string }
type PlatformCaretaker = { id: string; name: string; email?: string }
type PlatformLandlordWorkspace = { landlord: AccessUser; data: Partial<RentalWorkspaceData>; directPayments: RentPaymentRecord[]; caretakers: PlatformCaretaker[]; caretakerAssignments: PlatformCaretakerAssignment[]; updatedAt?: string }
const properties: PropertyRecord[] = []
type ModalType = 'property' | 'tenant' | 'maintenance' | 'payment' | 'document' | 'waterBill'
const modalConfig: Record<ModalType, { title: string; description: string; fields: { key: string; label: string; placeholder: string; type?: string }[] }> = {
  property: { title: 'Add property', description: 'Add only the unit types this property has, with their unit counts and monthly rents.', fields: [{ key: 'name', label: 'Property name', placeholder: 'e.g. Willow Gardens' }, { key: 'address', label: 'Address', placeholder: 'e.g. 24 Willow Lane' }] },
  tenant: { title: 'Add tenant', description: 'Select a property and vacant unit. The first rent payment is due 30 days after the tenant is assigned. A portal login code is generated automatically.', fields: [{ key: 'name', label: 'Tenant name', placeholder: 'e.g. Alex Morgan' }, { key: 'email', label: 'Tenant email address', placeholder: 'e.g. alex@example.com', type: 'email' }, { key: 'phone', label: 'Mobile number', placeholder: 'e.g. 0712 345 678', type: 'tel' }, { key: 'idNumber', label: 'National ID / passport', placeholder: 'e.g. 12345678' }, { key: 'property', label: 'Property / apartment', placeholder: 'Select a property' }, { key: 'unit', label: 'Available unit', placeholder: 'Select a vacant unit' }, { key: 'assignedDate', label: 'Tenant assigned / move-in date', placeholder: '', type: 'date' }, { key: 'leaseEnd', label: 'Lease end date', placeholder: '', type: 'date' }, { key: 'portalCode', label: 'Tenant portal code', placeholder: '' }] },
  maintenance: { title: 'Add maintenance request', description: 'Log an issue for your maintenance team and identify the exact house or unit.', fields: [{ key: 'maintenanceType', label: 'Maintenance type', placeholder: 'Select a maintenance type' }, { key: 'issue', label: 'Issue description', placeholder: 'e.g. Broken window' }, { key: 'property', label: 'Property / apartment', placeholder: 'e.g. Juniper Court' }, { key: 'houseNumber', label: 'House / unit number', placeholder: 'e.g. 2A' }, { key: 'priority', label: 'Priority', placeholder: 'Select priority' }] },
  payment: { title: 'Add payment', description: 'Manually record cash, bank, or other payments. Direct Paybill rent is recorded automatically after Safaricom confirms it.', fields: [{ key: 'amount', label: 'Amount (KSh)', placeholder: 'e.g. 1800', type: 'number' }, { key: 'property', label: 'Property / apartment', placeholder: 'Select a property' }, { key: 'houseNumber', label: 'House / unit number', placeholder: 'Select a house or unit' }, { key: 'paymentMethod', label: 'Payment method', placeholder: 'Select a method' }, { key: 'reference', label: 'M-Pesa / receipt reference', placeholder: 'e.g. QWE123ABCD' }, { key: 'period', label: 'Payment period', placeholder: 'e.g. January 2025' }, { key: 'date', label: 'Payment date', placeholder: '', type: 'date' }] },
  document: { title: 'Add document', description: 'Save a reference to an important property document.', fields: [{ key: 'name', label: 'Document name', placeholder: 'e.g. Lease agreement' }, { key: 'property', label: 'Property', placeholder: 'e.g. Parkview Lofts' }, { key: 'date', label: 'Document date', placeholder: '', type: 'date' }] },
  waterBill: { title: 'Update water bill', description: 'Enter the current water charge for this tenant.', fields: [{ key: 'amount', label: 'Water bill (KSh)', placeholder: 'e.g. 850', type: 'number' }] },
}
const sectionDetails: Record<string, { eyebrow: string; title: string; description: string; rows: string[] }> = {
  Properties: { eyebrow: 'Portfolio', title: 'Properties', description: 'Manage buildings, units, occupancy, and property performance.', rows: [] },
  Tenants: { eyebrow: 'Residents', title: 'Tenants', description: 'Keep track of residents, leases, and contact details in one place.', rows: [] },
  Maintenance: { eyebrow: 'Operations', title: 'Maintenance', description: 'Review open requests and keep every property running smoothly.', rows: [] },
  Payments: { eyebrow: 'Finance', title: 'Payments', description: 'Monitor rent collection, upcoming charges, and payment history.', rows: [] },
  Documents: { eyebrow: 'Records', title: 'Documents', description: 'Access leases, inspection reports, and important property records.', rows: [] },
  Settings: { eyebrow: 'Workspace', title: 'Settings', description: 'Configure your workspace, notifications, and team access.', rows: [] },
  'Help center': { eyebrow: 'Support', title: 'Help center', description: 'Find answers and get support for your property operations.', rows: ['Getting started with Moha Rental Management System', 'Managing a maintenance request', 'Inviting a team member'] },
}

function readStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) as T : fallback
  } catch {
    return fallback
  }
}

const defaultWorkspaceSettings: RentalWorkspaceSettings = { workspaceName: 'Moha Rental Management System', propertyGroup: 'Atlas Properties', darkMode: false, notifEmail: true, notifWeekly: true, rentReminderEnabled: true, rentReminderDays: 3, rentReminderChannel: 'WhatsApp', landlordPaybill: import.meta.env.VITE_MPESA_RENT_PAYBILL ?? '', landlordPaymentMethod: 'paybill', landlordTillNumber: '', landlordBankName: '', landlordBankAccountName: '', landlordBankAccountNumber: '' }
const rentPaybill = import.meta.env.VITE_MPESA_RENT_PAYBILL ?? ''
const legacyWorkspaceKeys = ['hearthwise-properties', 'hearthwise-units', 'hearthwise-tenants', 'hearthwise-records', 'hearthwise-invoices', 'hearthwise-maintenance-completed', 'hearthwise-expenses', 'hearthwise-applicants', 'moha-workspace-name', 'moha-property-group', 'moha-dark-mode', 'moha-notif-email', 'moha-notif-weekly', 'moha-landlord-paybill']

function readLegacyWorkspace(): RentalWorkspaceData {
  return {
    properties: readStorage('hearthwise-properties', properties),
    units: readStorage('hearthwise-units', {}),
    tenants: readStorage('hearthwise-tenants', []),
    records: readStorage('hearthwise-records', {}),
    invoices: readStorage('hearthwise-invoices', []),
    maintenance: readStorage('hearthwise-maintenance-completed', {}),
    expenses: readStorage('hearthwise-expenses', []),
    applicants: readStorage('hearthwise-applicants', []),
    settings: {
      workspaceName: readStorage('moha-workspace-name', defaultWorkspaceSettings.workspaceName),
      propertyGroup: readStorage('moha-property-group', defaultWorkspaceSettings.propertyGroup),
      darkMode: readStorage('moha-dark-mode', defaultWorkspaceSettings.darkMode),
      notifEmail: readStorage('moha-notif-email', defaultWorkspaceSettings.notifEmail),
      notifWeekly: readStorage('moha-notif-weekly', defaultWorkspaceSettings.notifWeekly),
      rentReminderEnabled: readStorage('moha-rent-reminder-enabled', defaultWorkspaceSettings.rentReminderEnabled),
      rentReminderDays: readStorage('moha-rent-reminder-days', defaultWorkspaceSettings.rentReminderDays),
      rentReminderChannel: readStorage('moha-rent-reminder-channel', defaultWorkspaceSettings.rentReminderChannel),
      landlordPaybill: readStorage('moha-landlord-paybill', defaultWorkspaceSettings.landlordPaybill),
      landlordPaymentMethod: readStorage('moha-landlord-payment-method', defaultWorkspaceSettings.landlordPaymentMethod),
      landlordTillNumber: readStorage('moha-landlord-till-number', defaultWorkspaceSettings.landlordTillNumber),
      landlordBankName: readStorage('moha-landlord-bank-name', defaultWorkspaceSettings.landlordBankName),
      landlordBankAccountName: readStorage('moha-landlord-bank-account-name', defaultWorkspaceSettings.landlordBankAccountName),
      landlordBankAccountNumber: readStorage('moha-landlord-bank-account-number', defaultWorkspaceSettings.landlordBankAccountNumber),
    },
  }
}

function removeLegacyWorkspace() {
  legacyWorkspaceKeys.forEach(key => localStorage.removeItem(key))
  localStorage.removeItem('moha-access-users')
  localStorage.removeItem('moha-session-user')
}

function MohaLogo({ size = 28, className = '' }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" role="img">
    <rect x="5" y="5" width="54" height="54" rx="16" fill="#103b35" />
    <path d="M16 38V22L26 31L32 25L38 31L48 22V38" fill="none" stroke="#f4d790" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 38V28H28V38M36 38V28H42V38" fill="none" stroke="#f4d790" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 44H50" stroke="#f4d790" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
  </svg>
}

function mapDatabaseRole(value: string | undefined): AccessUser['role'] {
  switch (value?.toLowerCase()) {
    case 'administrator':
    case 'admin': return 'Administrator'
    case 'manager': return 'Manager'
    case 'caretaker': return 'Caretaker'
    case 'accountant': return 'Accountant'
    default: return 'Viewer'
  }
}

function mapDatabaseUserType(value: string | undefined): AccessUser['userType'] {
  return value === 'platform_admin' ? 'Platform Administrator' : value === 'Property Manager' || value === 'property_manager' ? 'Property Manager' : value === 'Caretaker' || value === 'caretaker' ? 'Caretaker' : 'Landlord'
}

function oneYearAfter(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00`)
  const originalMonth = date.getMonth()
  date.setFullYear(date.getFullYear() + 1)
  if (date.getMonth() !== originalMonth) date.setDate(0)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeWhatsAppPhone(phone?: string) {
  let digits = phone?.replace(/\D/g, '') ?? ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`
  else if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`
  return digits.length >= 10 && digits.length <= 15 ? digits : ''
}

function getKenyanPhoneDigits(phone?: string) {
  let digits = phone?.replace(/\D/g, '') ?? ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('254')) digits = digits.slice(3)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 9)
}

function normalizeKenyanPhone(phone?: string) {
  const digits = getKenyanPhoneDigits(phone)
  return /^\d{9}$/.test(digits) ? `254${digits}` : ''
}

function getTenantUnitLabel(tenant: Pick<TenantRecord, 'unit' | 'unitDisplayName'>) {
  return tenant.unitDisplayName || tenant.unit
}

function getPaybillAccountReference(tenant: Pick<TenantRecord, 'property' | 'unit' | 'unitDisplayName'>) {
  return `${tenant.property}-${getTenantUnitLabel(tenant)}`
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildRentWhatsAppMessage({ workspaceName, tenant, rent, waterBill, paymentDetails, dueDate, movedIn, invoiceNumber }: {
  workspaceName: string
  tenant: Pick<TenantRecord, 'name' | 'property' | 'unit' | 'unitDisplayName' | 'rentAccountRef'>
  rent: string | number
  waterBill: string | number
  paymentDetails: LandlordPaymentDetails
  dueDate?: string
  movedIn?: string
  invoiceNumber?: string
}) {
  const rentAmount = Number(String(rent).replace(/[^0-9.]/g, '')) || 0
  const waterAmount = Number(String(waterBill).replace(/[^0-9.]/g, '')) || 0
  return [
    `Dear ${tenant.name},`,
    '',
    invoiceNumber ? `Please find your rent invoice from ${workspaceName} below.` : `This is a courteous rent reminder from ${workspaceName}.`,
    ...(invoiceNumber ? [`Invoice number: ${invoiceNumber}`] : []),
    `Property: ${tenant.property}`,
    `Unit: ${getTenantUnitLabel(tenant)}`,
    ...(dueDate ? [`Rent due date: ${dueDate}`] : []),
    ...(movedIn ? [`Move-in date: ${movedIn}`] : []),
    '',
    `Monthly rent: KSh ${rentAmount.toLocaleString()}`,
    `Water bill: KSh ${waterAmount.toLocaleString()}`,
    `Total amount due: KSh ${(rentAmount + waterAmount).toLocaleString()}`,
    '',
    'Payment instructions',
    ...buildPaymentInstructionLines(paymentDetails, tenant),
    '',
    invoiceNumber ? 'If you have already paid, please contact us so we can update our records.' : 'If you have already paid, please disregard this reminder.',
    '',
    `Kind regards,\n${workspaceName}`,
  ].join('\n')
}

function buildPaymentInstructionLines(paymentDetails: LandlordPaymentDetails, tenant: Pick<TenantRecord, 'property' | 'unit' | 'unitDisplayName' | 'rentAccountRef'>) {
  if (paymentDetails.method === 'till') return [`Till number: ${paymentDetails.tillNumber.trim() || 'Not configured'}`]
  if (paymentDetails.method === 'bank_transfer') return [
    `Bank: ${paymentDetails.bankName.trim() || 'Not configured'}`,
    `Account name: ${paymentDetails.bankAccountName.trim() || 'Not configured'}`,
    `Account number: ${paymentDetails.bankAccountNumber.trim() || 'Not configured'}`,
  ]
  return [
    `Paybill number: ${paymentDetails.paybillNumber.trim() || 'Not configured'}`,
    `Account number: ${getPaybillAccountReference(tenant) || tenant.rentAccountRef || 'Not assigned'}`,
  ]
}

function getFirstRentDueDate(movedIn?: string) {
  if (!movedIn) return null
  const dueDate = new Date(`${movedIn}T00:00:00`)
  if (Number.isNaN(dueDate.getTime())) return null
  dueDate.setDate(dueDate.getDate() + 30)
  return dueDate
}

function getRentDueDateAtCycle(firstDueDate: Date, offset: number) {
  const targetMonth = new Date(firstDueDate.getFullYear(), firstDueDate.getMonth() + offset, 1)
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate()
  return new Date(targetMonth.getFullYear(), targetMonth.getMonth(), Math.min(firstDueDate.getDate(), lastDay))
}

function getNextMonthlyRentDueDate(movedIn?: string, referenceDate = new Date()) {
  const today = new Date(referenceDate)
  today.setHours(0, 0, 0, 0)
  const firstDueDate = getFirstRentDueDate(movedIn) ?? new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
  firstDueDate.setHours(0, 0, 0, 0)
  if (firstDueDate >= today) return firstDueDate
  let monthOffset = Math.max(0, (today.getFullYear() - firstDueDate.getFullYear()) * 12 + today.getMonth() - firstDueDate.getMonth())
  let dueDate = getRentDueDateAtCycle(firstDueDate, monthOffset)
  while (dueDate < today) {
    monthOffset += 1
    dueDate = getRentDueDateAtCycle(firstDueDate, monthOffset)
  }
  return dueDate
}

function getCurrentRentCycle(movedIn?: string, referenceDate = new Date()) {
  const today = new Date(referenceDate)
  today.setHours(0, 0, 0, 0)
  const firstDueDate = getFirstRentDueDate(movedIn)
  if (!firstDueDate || firstDueDate > today) return null
  let monthOffset = Math.max(0, (today.getFullYear() - firstDueDate.getFullYear()) * 12 + today.getMonth() - firstDueDate.getMonth())
  if (getRentDueDateAtCycle(firstDueDate, monthOffset) > today) monthOffset -= 1
  if (monthOffset < 0) return null
  return {
    dueDate: getRentDueDateAtCycle(firstDueDate, monthOffset),
    periodStart: monthOffset === 0 ? new Date(`${movedIn}T00:00:00`) : getRentDueDateAtCycle(firstDueDate, monthOffset - 1),
  }
}

function makeRentAccountReference() {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return `R${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function makeTenantPortalCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

function createDemoTenantSample() {
  const propertyName = 'Willow Gardens'
  const unitName = '2B'
  const tenantEmail = 'jane@example.com'
  const portalCode = 'RDEMO1234'
  return {
    propertyList: [{ name: propertyName, address: '24 Willow Lane', units: 1, occupied: 1, income: 'KSh 18,000', status: 'Healthy', color: 'blue' }],
    unitDetails: {
      [propertyName]: [{ unit: unitName, type: '2 Bedroom', tenant: 'Jane Wanjiku', status: 'Occupied', rent: 'KSh 18,000' }],
    },
    tenantList: [{
      name: 'Jane Wanjiku',
      email: tenantEmail,
      phone: '0712 345 678',
      idNumber: '12345678',
      unit: unitName,
      unitType: '2 Bedroom',
      property: propertyName,
      rent: '18000',
      lease: 'Ends Nov 2027',
      leaseEnd: '2027-11-30',
      movedIn: '2025-01-15',
      rentAccountRef: makeRentAccountReference(),
      portalCode,
      status: 'Active',
      waterBill: '0',
    }],
    payments: ['KSh 18000 · Jane Wanjiku · House 2B · Willow Gardens · 2025-10-01 · M-Pesa · TXN123ABC · October 2025'],
    credentials: { email: tenantEmail, portalCode },
  }
}

function toDatabaseRole(value: AccessUser['role']) {
  return value === 'Administrator' ? 'admin' : value.toLowerCase()
}

function toDatabaseUserType(value: AccessUser['userType']) {
  return value === 'Platform Administrator' ? 'platform_admin' : value === 'Property Manager' ? 'property_manager' : value.toLowerCase()
}

function App() {
  const [activeSection, setActiveSection] = useState('Overview')
  const [query, setQuery] = useState('')
  const [overviewRevenuePage, setOverviewRevenuePage] = useState(1)
  const [overviewActivityPage, setOverviewActivityPage] = useState(1)
  const [overviewReminderPage, setOverviewReminderPage] = useState(1)
  const [overviewPropertyPage, setOverviewPropertyPage] = useState(1)
  const [showNotice, setShowNotice] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showResetSelf, setShowResetSelf] = useState(false)
  const [selfNewPassword, setSelfNewPassword] = useState('')
  const [selfPasswordMsg, setSelfPasswordMsg] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false)
  const [subscriptionForm, setSubscriptionForm] = useState<{ plan: PaidSubscriptionPlan; mpesaCode: string; amount: number }>({ plan: 'silver_monthly', mpesaCode: '', amount: 500 })
  const [subscriptionFeedback, setSubscriptionFeedback] = useState('')
  const [subscriptionPaymentDetails, setSubscriptionPaymentDetails] = useState<SubscriptionPaymentDetails>(defaultSubscriptionPaymentDetails)
  const [subscriptionPaymentSettingsError, setSubscriptionPaymentSettingsError] = useState('')
  const [subscriptionPaymentSettingsLoading, setSubscriptionPaymentSettingsLoading] = useState(false)
    // Edit state for property and tenant management
  const [editingProperty, setEditingProperty] = useState<PropertyRecord | null>(null)
  const [editingTenant, setEditingTenant] = useState<TenantRecord | null>(null)
  const [editingPaymentIdx, setEditingPaymentIdx] = useState<number | null>(null)
  const [editingMaintenanceIdx, setEditingMaintenanceIdx] = useState<number | null>(null)
  const [editingExpense, setEditingExpense] = useState<ExpenseRecord | null>(null)
  const [editingApplicant, setEditingApplicant] = useState<ApplicantRecord | null>(null)
  // Tenant profile
  const [viewingTenant, setViewingTenant] = useState<TenantRecord | null>(null)
  const [copiedPortalCode, setCopiedPortalCode] = useState('')
  const loginTime = useRef(new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }))
  useEffect(() => {
    if (!showProfile && !showNotice) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.profile-dropdown') && !target.closest('.profile-trigger') && !target.closest('.notification-popover') && !target.closest('.icon-button')) {
        setShowProfile(false)
        setShowNotice(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showProfile, showNotice])
  useEffect(() => {
    if (!sidebarOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sidebarOpen])
  const [darkMode, setDarkMode] = useState(defaultWorkspaceSettings.darkMode)
  const [users, setUsers] = useState<AccessUser[]>([])
  const [platformLandlordWorkspaces, setPlatformLandlordWorkspaces] = useState<PlatformLandlordWorkspace[]>([])
  const [platformPortfolioLoading, setPlatformPortfolioLoading] = useState(false)
  const [platformPortfolioError, setPlatformPortfolioError] = useState('')
  const [sessionUser, setSessionUser] = useState<AccessUser | null>(null)
  const [tenantPortalSession, setTenantPortalSession] = useState<TenantPortalSession | null>(null)
  const [tenantPortalForm, setTenantPortalForm] = useState({ email: '', portalCode: '' })
  const [tenantPortalError, setTenantPortalError] = useState('')
  const [homePage, setHomePage] = useState(() => typeof window !== 'undefined' && window.location.pathname === '/')
  const [tenantPublicView, setTenantPublicView] = useState(() => typeof window !== 'undefined' ? ['/tenant', '/tenants', '/portal'].includes(window.location.pathname) : false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [landlordSignupPage, setLandlordSignupPage] = useState(() => typeof window !== 'undefined' && window.location.pathname === '/landlord-signup')
  const [pendingLandlordApproval, setPendingLandlordApproval] = useState<{ name: string; email: string; plan: PublicLandlordPlan | null; status: 'pending' | 'rejected' } | null>(null)
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured)
  const [authMessage, setAuthMessage] = useState('')
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false)
  const [modalType, setModalType] = useState<ModalType | null>(null)
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null)
  const [propertyList, setPropertyList] = useState<PropertyRecord[]>(properties)
  const [unitDetails, setUnitDetails] = useState<Record<string, UnitRecord[]>>({})
  const [tenantList, setTenantList] = useState<TenantRecord[]>([])
  const [savedRows, setSavedRows] = useState<Record<string, string[]>>({})
  const [directRentPayments, setDirectRentPayments] = useState<RentPaymentRecord[]>([])
  const [rentPaymentsRefreshing, setRentPaymentsRefreshing] = useState(false)
  const [rentPaymentsRefreshError, setRentPaymentsRefreshError] = useState('')
  const [selectedTenant, setSelectedTenant] = useState<TenantRecord | null>(null)
  const [invoiceTenant, setInvoiceTenant] = useState<TenantRecord | null>(null)
  const [selectedMaintenance, setSelectedMaintenance] = useState<string | null>(null)
  const [completedMaintenance, setCompletedMaintenance] = useState<Record<string, boolean>>({})
  const [invoiceList, setInvoiceList] = useState<InvoiceRecord[]>([])
  const [activeInvoice, setActiveInvoice] = useState<InvoiceRecord | null>(null)
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([])
  const [applicants, setApplicants] = useState<ApplicantRecord[]>([])
  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceSettings.workspaceName)
  const [propertyGroup, setPropertyGroup] = useState(defaultWorkspaceSettings.propertyGroup)
  const [landlordPaybill, setLandlordPaybill] = useState(defaultWorkspaceSettings.landlordPaybill)
  const [landlordPaymentMethod, setLandlordPaymentMethod] = useState<LandlordPaymentMethod>(defaultWorkspaceSettings.landlordPaymentMethod)
  const [landlordTillNumber, setLandlordTillNumber] = useState(defaultWorkspaceSettings.landlordTillNumber)
  const [landlordBankName, setLandlordBankName] = useState(defaultWorkspaceSettings.landlordBankName)
  const [landlordBankAccountName, setLandlordBankAccountName] = useState(defaultWorkspaceSettings.landlordBankAccountName)
  const [landlordBankAccountNumber, setLandlordBankAccountNumber] = useState(defaultWorkspaceSettings.landlordBankAccountNumber)
  const [notifEmail, setNotifEmail] = useState(defaultWorkspaceSettings.notifEmail)
  const [notifWeekly, setNotifWeekly] = useState(defaultWorkspaceSettings.notifWeekly)
  const [rentReminderEnabled, setRentReminderEnabled] = useState(defaultWorkspaceSettings.rentReminderEnabled)
  const [rentReminderDays, setRentReminderDays] = useState(defaultWorkspaceSettings.rentReminderDays)
  const [rentReminderChannel, setRentReminderChannel] = useState<RentReminderChannel>(defaultWorkspaceSettings.rentReminderChannel)
  const [cloudStatus, setCloudStatus] = useState(isSupabaseConfigured ? 'Connecting to Supabase' : 'Supabase is not configured')
  const [cloudOwnerId, setCloudOwnerId] = useState<string | null>(null)
  const cloudHydrated = useRef(false)
  const openSubscriptionModal = async () => {
    setShowProfile(false)
    setSubscriptionFeedback('')
    setSubscriptionPaymentSettingsError('')
    setSubscriptionPaymentSettingsLoading(true)
    setShowSubscriptionModal(true)
    if (!supabase) {
      setSubscriptionPaymentSettingsError('Supabase is not configured.')
      setSubscriptionPaymentSettingsLoading(false)
      return
    }
    const { data, error } = await supabase.from('subscription_payment_settings')
      .select('payment_method, paybill_number, till_number, bank_name, bank_account_name, bank_account_number')
      .eq('id', true)
      .maybeSingle()
    if (error) setSubscriptionPaymentSettingsError(error.message)
    else setSubscriptionPaymentDetails(data ? {
      method: data.payment_method as LandlordPaymentMethod,
      paybillNumber: data.paybill_number,
      tillNumber: data.till_number,
      bankName: data.bank_name,
      bankAccountName: data.bank_account_name,
      bankAccountNumber: data.bank_account_number,
    } : defaultSubscriptionPaymentDetails)
    setSubscriptionPaymentSettingsLoading(false)
  }
  const effectiveRentPaybill = landlordPaybill.trim() || rentPaybill
  const landlordPaymentDetails: LandlordPaymentDetails = { method: landlordPaymentMethod, paybillNumber: landlordPaybill, tillNumber: landlordTillNumber, bankName: landlordBankName, bankAccountName: landlordBankAccountName, bankAccountNumber: landlordBankAccountNumber }
  const refreshConfirmedRentPayments = async () => {
    if (!supabase || !cloudOwnerId) {
      setRentPaymentsRefreshError('Sign in to a landlord workspace before refreshing confirmed rent payments.')
      return
    }
    setRentPaymentsRefreshing(true)
    setRentPaymentsRefreshError('')
    try {
      const { data, error } = await supabase.from('rent_payments')
        .select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name')
        .eq('owner_id', cloudOwnerId)
        .order('transacted_at', { ascending: false })
      if (error) {
        setRentPaymentsRefreshError(`Could not refresh confirmed rent payments: ${error.message}`)
        return
      }
      setDirectRentPayments(data ?? [])
    } catch (error) {
      setRentPaymentsRefreshError(`Could not refresh confirmed rent payments: ${error instanceof Error ? error.message : 'Unexpected request failure.'}`)
    } finally {
      setRentPaymentsRefreshing(false)
    }
  }
  const refreshPlatformPortfolio = async () => {
    if (!supabase || !authUser || sessionUser?.userType !== 'Platform Administrator') {
      setPlatformPortfolioError('Sign in as the Platform Administrator to load all Landlord portfolios.')
      return
    }
    setPlatformPortfolioLoading(true)
    setPlatformPortfolioError('')
    const { data, error: profilesError } = await supabase.rpc('get_platform_admin_accounts')
    if (profilesError) {
      setPlatformPortfolioError(`Could not read Landlord accounts. Rerun supabase/subscription_payment_admin_queue.sql in Supabase SQL Editor. Details: ${profilesError.message}`)
      setPlatformPortfolioLoading(false)
      return
    }
    const profiles = (data ?? []) as PlatformAdminAccountRow[]
    const landlordProfiles = profiles.filter(profile => profile.user_type === 'landlord')
    const landlordIds = landlordProfiles.map(profile => profile.user_id)
    const knownLandlordIds = new Set([
      ...users.filter(account => account.userType === 'Landlord').map(account => account.id),
      ...platformLandlordWorkspaces.map(workspace => workspace.landlord.id),
    ])
    const returnedLandlordIds = new Set(landlordIds)
    const missingKnownLandlords = [...knownLandlordIds].filter(id => !returnedLandlordIds.has(id))
    if (missingKnownLandlords.length) {
      setPlatformPortfolioError(`The account query returned ${landlordIds.length} Landlords, but ${missingKnownLandlords.length} previously loaded account(s) are missing. The current dashboard data was kept. Check platform account visibility in Supabase before replacing it.`)
      setPlatformPortfolioLoading(false)
      return
    }
    if (!landlordIds.length) {
      if (users.some(account => account.userType === 'Landlord') || platformLandlordWorkspaces.length > 0) {
        setPlatformPortfolioError('Supabase returned no Landlord profiles during refresh. The last loaded portfolio is being kept; check profile visibility and rerun supabase/user_hierarchy.sql if needed.')
      } else {
        setPlatformLandlordWorkspaces([])
      }
      setPlatformPortfolioLoading(false)
      return
    }
    const [workspacesResult, allWorkspaceRowsResult, assignmentsResult] = await Promise.all([
      supabase.from('rental_workspaces').select('owner_id, data, updated_at').in('owner_id', landlordIds),
      supabase.from('rental_workspaces').select('owner_id, data, updated_at').limit(5000),
      supabase.from('caretaker_assignments').select('landlord_id, caretaker_id, property_name, unit_name, active').in('landlord_id', landlordIds).eq('active', true),
    ])
    if (workspacesResult.error || allWorkspaceRowsResult.error) {
      const detail = workspacesResult.error?.message ?? allWorkspaceRowsResult.error?.message ?? 'Unknown Supabase query error.'
      setPlatformPortfolioError(`Could not load Landlord roles or workspaces. Rerun supabase/user_hierarchy.sql in Supabase SQL Editor. Details: ${detail}`)
      setPlatformPortfolioLoading(false)
      return
    }
    const landlordAccounts: AccessUser[] = landlordProfiles.map(profile => {
      return {
        id: profile.user_id,
        name: profile.display_name || profile.email || 'Landlord',
        username: profile.email || profile.user_id,
        email: profile.email ?? undefined,
        phone: profile.phone ?? undefined,
        userType: 'Landlord',
        role: mapDatabaseRole(profile.account_role),
        active: profile.account_active,
        signupStatus: profile.signup_status as LandlordSignupStatus | undefined,
        requestedPlan: profile.requested_plan as PublicLandlordPlan | undefined,
      }
    })
    const workspaceRows = allWorkspaceRowsResult.data ?? []
    const findWorkspaceRowForLandlord = (profile: { user_id: string; owner_id?: string | null }) => {
      const candidates = [profile.user_id, profile.owner_id].filter((value): value is string => Boolean(value))
      const directMatch = candidates
        .map(candidate => workspaceRows.find(row => row.owner_id === candidate))
        .find(Boolean)
      if (directMatch) return directMatch
      const candidateSet = new Set(candidates)
      return workspaceRows.find(row => {
        if (!candidateSet.has(row.owner_id)) return false
        const data = row.data ?? {}
        return Array.isArray(data.properties) || Array.isArray(data.tenants) || (data.units && typeof data.units === 'object') || (data.records && typeof data.records === 'object')
      })
    }
    const paymentsResult = rentPaybill
      ? await supabase.from('rent_payments').select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name').in('owner_id', landlordIds).order('transacted_at', { ascending: false })
      : { data: [], error: null }
    if (paymentsResult.error) setCloudStatus(`Confirmed rent payments unavailable in portfolio: ${paymentsResult.error.message}`)
    const activeAssignments = assignmentsResult.data ?? []
    const caretakerProfilesResult = await supabase.from('profiles').select('user_id, display_name, email, owner_id').eq('user_type', 'caretaker').in('owner_id', landlordIds)
    if (assignmentsResult.error || caretakerProfilesResult.error) {
      const detail = assignmentsResult.error?.message ?? caretakerProfilesResult.error?.message
      setPlatformPortfolioError(`Caretaker details are unavailable. Check caretaker_assignments access and profile policies. Details: ${detail}`)
    }
    const caretakerProfiles = new Map((caretakerProfilesResult.data ?? []).map(profile => [profile.user_id, profile]))
    setUsers(current => [
      ...current.filter(account => account.userType !== 'Landlord'),
      ...landlordAccounts,
    ])
    setPlatformLandlordWorkspaces(landlordAccounts.map(landlord => {
      const profile = landlordProfiles.find(item => item.user_id === landlord.id)
      const row = findWorkspaceRowForLandlord({ user_id: landlord.id, owner_id: profile?.owner_id ?? null })
      const workspaceRow = row ?? workspacesResult.data.find(workspace => workspace.owner_id === landlord.id)
      return {
        landlord,
        data: (workspaceRow?.data ?? row?.data ?? {}) as Partial<RentalWorkspaceData>,
        directPayments: ((paymentsResult.data ?? []) as RentPaymentRecord[]).filter(payment => payment.owner_id === landlord.id),
        caretakers: (caretakerProfilesResult.data ?? []).filter(caretaker => caretaker.owner_id === landlord.id).map(caretaker => ({
          id: caretaker.user_id,
          name: caretaker.display_name || caretaker.email || 'Caretaker',
          email: caretaker.email ?? undefined,
        })),
        caretakerAssignments: activeAssignments.filter(assignment => assignment.landlord_id === landlord.id).map(assignment => {
          const caretaker = caretakerProfiles.get(assignment.caretaker_id)
          return {
            caretakerId: assignment.caretaker_id,
            caretakerName: caretaker?.display_name || caretaker?.email || 'Caretaker',
            caretakerEmail: caretaker?.email ?? undefined,
            property: assignment.property_name,
            unit: assignment.unit_name,
          }
        }),
        updatedAt: workspaceRow?.updated_at ?? row?.updated_at,
      }
    }))
    setPlatformPortfolioLoading(false)
  }
  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    let active = true
    const authCallbackType = new URLSearchParams(`${window.location.search}&${window.location.hash.replace(/^#/, '')}`).get('type')
    if (authCallbackType === 'invite' || authCallbackType === 'recovery') setShowPasswordRecovery(true)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      setAuthUser(authSession?.user ?? null)
      if (authSession?.user) setAuthMessage('')
      if (event === 'PASSWORD_RECOVERY') setShowPasswordRecovery(true)
      setAuthReady(true)
    })
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthMessage(error.message)
      setAuthUser(data.session?.user ?? null)
      setAuthReady(true)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    const client = supabase
    if (!client || !authUser) {
      cloudHydrated.current = false
      setCloudOwnerId(null)
      setSessionUser(null)
      setPendingLandlordApproval(null)
      setUsers([])
      setPlatformLandlordWorkspaces([])
      setPlatformPortfolioLoading(false)
      setPlatformPortfolioError('')
      return
    }
    let active = true
    cloudHydrated.current = false
    setCloudOwnerId(null)
    setCloudStatus('Loading Supabase account and workspace')
    const hydrateCloudWorkspace = async () => {
      const [profileResult, roleResult] = await Promise.all([
        client.from('profiles').select('display_name, email, phone, user_type, owner_id, created_by, signup_status, requested_plan').eq('user_id', authUser.id).maybeSingle(),
        client.from('user_roles').select('role, active').eq('user_id', authUser.id).maybeSingle(),
      ])
      if (!active) return
      if (profileResult.error || roleResult.error || !profileResult.data || !roleResult.data) {
        const message = profileResult.error?.message ?? roleResult.error?.message ?? 'This Supabase account has no profile or role. Run the subscription payment SQL migration.'
        setAuthMessage(message)
        setCloudStatus(`Supabase account setup error: ${message}`)
        await client.auth.signOut()
        return
      }
      const signupStatus = profileResult.data.signup_status as LandlordSignupStatus | undefined
      if (profileResult.data.user_type === 'landlord' && signupStatus === 'pending') {
        setPendingLandlordApproval({
          name: profileResult.data.display_name || authUser.email?.split('@')[0] || 'Landlord',
          email: profileResult.data.email ?? authUser.email ?? '',
          plan: profileResult.data.requested_plan as PublicLandlordPlan | null,
          status: 'pending',
        })
        return
      }
      if (profileResult.data.user_type === 'landlord' && signupStatus === 'rejected') {
        setPendingLandlordApproval({
          name: profileResult.data.display_name || authUser.email?.split('@')[0] || 'Landlord',
          email: profileResult.data.email ?? authUser.email ?? '',
          plan: profileResult.data.requested_plan as PublicLandlordPlan | null,
          status: 'rejected',
        })
        return
      }
      if (!roleResult.data.active) {
        setAuthMessage('This account is disabled. Contact your administrator.')
        await client.auth.signOut()
        return
      }
      const workspaceOwnerId = profileResult.data.owner_id || authUser.id
      const user: AccessUser = {
        id: authUser.id,
        name: profileResult.data.display_name || authUser.email?.split('@')[0] || 'User',
        username: authUser.email ?? '',
        email: profileResult.data.email ?? authUser.email ?? '',
        phone: profileResult.data.phone ?? undefined,
        userType: mapDatabaseUserType(profileResult.data.user_type),
        role: mapDatabaseRole(roleResult.data.role),
        active: roleResult.data.active,
      }
      const ownerCandidates = Array.from(new Set([profileResult.data.owner_id, authUser.id].filter((value): value is string => Boolean(value))))
      const [subscriptionResult, requestResult, workspaceResult, fallbackWorkspaceResult] = await Promise.all([
        client.from('subscriptions').select('plan, status, starts_on, expires_on, amount').eq('user_id', authUser.id).maybeSingle(),
        client.from('subscription_payment_requests').select('id, plan, amount, mpesa_code, payment_method, status, submitted_at, reviewed_at').eq('user_id', authUser.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
        client.from('rental_workspaces').select('owner_id, data, updated_at').in('owner_id', ownerCandidates).order('updated_at', { ascending: false }).limit(1),
        client.from('rental_workspaces').select('owner_id, data, updated_at').order('updated_at', { ascending: false }).limit(500),
      ])
      if (!active) return
      const dataError = subscriptionResult.error?.message ?? requestResult.error?.message ?? workspaceResult.error?.message ?? fallbackWorkspaceResult.error?.message
      if (dataError) {
        setAuthMessage(dataError)
        setCloudStatus(`Supabase data error: ${dataError}`)
        await client.auth.signOut()
        return
      }
      const resolvedWorkspaceRow = workspaceResult.data?.[0] ?? fallbackWorkspaceResult.data?.find(row => row.owner_id === workspaceOwnerId) ?? fallbackWorkspaceResult.data?.find(row => row.data && (Array.isArray(row.data.properties) || Array.isArray(row.data.tenants) || (row.data.units && typeof row.data.units === 'object') || (row.data.records && typeof row.data.records === 'object')))
      const { data: rentPayments, error: rentPaymentsError } = await client.from('rent_payments')
        .select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name')
        .eq('owner_id', workspaceOwnerId)
        .order('transacted_at', { ascending: false })
      if (!active) return
      if (rentPaymentsError) setCloudStatus(`Rent payments unavailable: ${rentPaymentsError.message}`)
      else setDirectRentPayments(rentPayments ?? [])
      if (subscriptionResult.data) {
        user.subscription = { plan: subscriptionResult.data.plan as SubscriptionPlan, status: subscriptionResult.data.status as SubscriptionStatus, startDate: subscriptionResult.data.starts_on, expiryDate: subscriptionResult.data.expires_on, amount: subscriptionResult.data.amount }
      }
      if (requestResult.data) {
        user.subscriptionRequest = { id: requestResult.data.id, plan: requestResult.data.plan as SubscriptionRequestPlan, amount: requestResult.data.amount, mpesaCode: requestResult.data.mpesa_code, paymentMethod: requestResult.data.payment_method as LandlordPaymentMethod, status: requestResult.data.status as 'pending' | 'approved' | 'rejected', submittedAt: requestResult.data.submitted_at, reviewedAt: requestResult.data.reviewed_at ?? undefined }
      }
      setSessionUser(user)
      if (user.role === 'Administrator') {
        const profilesQuery = client.from('profiles').select('user_id, display_name, email, phone, user_type, owner_id, signup_status, requested_plan')
        const profilesRequest = user.userType === 'Platform Administrator'
          ? profilesQuery.in('user_type', ['landlord', 'caretaker']).order('display_name')
          : profilesQuery.eq('owner_id', authUser.id).order('display_name')
        const rolesRequest = user.userType === 'Platform Administrator'
          ? client.from('user_roles').select('user_id, role, active')
          : client.from('user_roles').select('user_id, role, active').eq('owner_id', authUser.id)
        const platformAccountsRequest = user.userType === 'Platform Administrator'
          ? client.rpc('get_platform_admin_accounts')
          : Promise.resolve({ data: null, error: null })
        const assignmentsRequest = user.userType === 'Landlord'
          ? client.from('caretaker_assignments').select('landlord_id, caretaker_id, property_name, unit_name, active').eq('landlord_id', authUser.id)
          : user.userType === 'Platform Administrator'
            ? client.from('caretaker_assignments').select('landlord_id, caretaker_id, property_name, unit_name, active').limit(500)
            : null
        const [profilesResult, rolesResult, assignmentsResult, platformAccountsResult] = await Promise.all([
          profilesRequest,
          rolesRequest,
          assignmentsRequest ?? Promise.resolve({ data: [], error: null }),
          platformAccountsRequest,
        ])
        const platformAccountRows = (platformAccountsResult.data ?? []) as PlatformAdminAccountRow[]
        const accountProfiles = user.userType === 'Platform Administrator'
          ? platformAccountsResult.error ? profilesResult.data ?? [] : platformAccountRows
          : profilesResult.data ?? []
        const accountRoles = user.userType === 'Platform Administrator'
          ? platformAccountsResult.error
            ? rolesResult.data ?? []
            : platformAccountRows.map(profile => ({ user_id: profile.user_id, role: profile.account_role, active: profile.account_active }))
          : rolesResult.data ?? []
        const accountLoadError = user.userType === 'Platform Administrator'
          ? platformAccountsResult.error ? profilesResult.error ?? rolesResult.error : null
          : profilesResult.error ?? rolesResult.error
        if (user.userType === 'Platform Administrator' && platformAccountsResult.error) {
          setCloudStatus(`Platform directory RPC unavailable; using direct profile reads. Run supabase/subscription_payment_admin_queue.sql to load the complete directory. Details: ${platformAccountsResult.error.message}`)
        }
        if (!accountLoadError) {
          const [subscriptionsResult, requestsResult] = await Promise.all([
            client.from('subscriptions').select('user_id, plan, status, starts_on, expires_on, amount'),
            client.rpc('get_admin_subscription_payment_queue'),
          ])
          const subscriptions = subscriptionsResult.error ? [] : subscriptionsResult.data ?? []
          const requests = (requestsResult.data ?? []) as AdminSubscriptionPaymentQueueRow[]
          if (user.userType === 'Platform Administrator' && (subscriptionsResult.error || requestsResult.error)) {
            setCloudStatus(`Landlord accounts loaded; optional subscription data is unavailable: ${subscriptionsResult.error?.message ?? requestsResult.error?.message}`)
          } else if (requestsResult.error) {
            setCloudStatus(`Payment requests unavailable. Run supabase/subscription_payment_admin_queue.sql. Details: ${requestsResult.error.message}`)
          }
          const assignmentMap = new Map<string, Array<{ property: string; unit: string }>>()
          if (user.userType === 'Platform Administrator' && assignmentsResult.error) {
            setCloudStatus(`Caretaker assignments unavailable: ${assignmentsResult.error.message}`)
          }
          if (!assignmentsResult.error) {
            const assignmentRows = (assignmentsResult.data ?? []) as CaretakerAssignment[]
            for (const assignment of assignmentRows) {
              if (!assignment?.caretaker_id || !assignment?.property_name || !assignment?.unit_name) continue
              const existing = assignmentMap.get(assignment.caretaker_id) ?? []
              existing.push({ property: assignment.property_name, unit: assignment.unit_name })
              assignmentMap.set(assignment.caretaker_id, existing)
            }
          }
          const accountUsers = accountProfiles.map(profile => {
            const roleRecord = accountRoles.find(role => role.user_id === profile.user_id)
            const subscription = subscriptions.find(item => item.user_id === profile.user_id)
            const request = requests.find(item => item.user_id === profile.user_id)
            const cloudUser: AccessUser = {
              id: profile.user_id,
              name: profile.display_name || profile.email || 'User',
              username: profile.email || profile.user_id,
              email: profile.email ?? undefined,
              phone: profile.phone ?? undefined,
              userType: mapDatabaseUserType(profile.user_type),
              role: mapDatabaseRole(roleRecord?.role),
              active: roleRecord?.active ?? false,
              signupStatus: profile.signup_status as LandlordSignupStatus | undefined,
              requestedPlan: profile.requested_plan as PublicLandlordPlan | undefined,
              managedProperties: assignmentMap.get(profile.user_id) ?? undefined,
            }
            if (subscription) cloudUser.subscription = { plan: subscription.plan as SubscriptionPlan, status: subscription.status as SubscriptionStatus, startDate: subscription.starts_on, expiryDate: subscription.expires_on, amount: subscription.amount }
            if (request) cloudUser.subscriptionRequest = { id: request.request_id, plan: request.plan, amount: request.amount, mpesaCode: request.mpesa_code, paymentMethod: request.payment_method, status: request.status, submittedAt: request.submitted_at, reviewedAt: request.reviewed_at ?? undefined }
            return cloudUser
          })
          setUsers(accountUsers)
          if (user.userType === 'Platform Administrator') {
            const landlords = accountUsers.filter(account => account.userType === 'Landlord')
            const assignmentRows = !assignmentsResult.error ? (assignmentsResult.data ?? []) as CaretakerAssignment[] : []
            const caretakerProfiles = new Map(accountProfiles
              .filter(profile => mapDatabaseUserType(profile.user_type) === 'Caretaker')
              .map(profile => [profile.user_id, profile]))
            if (assignmentsResult.error) setCloudStatus(`Caretaker assignments unavailable: ${assignmentsResult.error.message}`)
            setPlatformPortfolioLoading(true)
            setPlatformPortfolioError('')
            if (landlords.length) {
              const landlordIds = landlords.map(landlord => landlord.id)
              const { data: workspaceRows, error: workspaceRowsError } = await client.from('rental_workspaces')
                .select('owner_id, data, updated_at')
                .in('owner_id', landlordIds)
              if (!active) return
              if (workspaceRowsError) {
                setPlatformLandlordWorkspaces([])
                setPlatformPortfolioError(`Could not read landlord workspaces. Rerun supabase/user_hierarchy.sql in the Supabase SQL Editor. Details: ${workspaceRowsError.message}`)
                setCloudStatus(`Could not load landlord portfolio: ${workspaceRowsError.message}`)
              } else {
                const directPaymentsResult = rentPaybill
                  ? await client.from('rent_payments').select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name').in('owner_id', landlordIds).order('transacted_at', { ascending: false })
                  : { data: [], error: null }
                if (!active) return
                if (directPaymentsResult.error) setCloudStatus(`Confirmed rent payments unavailable in portfolio: ${directPaymentsResult.error.message}`)
                setPlatformLandlordWorkspaces(landlords.map(landlord => {
                  const row = workspaceRows.find(workspace => workspace.owner_id === landlord.id)
                  return {
                    landlord,
                    data: (row?.data ?? {}) as Partial<RentalWorkspaceData>,
                    directPayments: (directPaymentsResult.data ?? []).filter(payment => payment.owner_id === landlord.id) as RentPaymentRecord[],
                    caretakers: accountProfiles.filter(profile => profile.user_type === 'caretaker' && profile.owner_id === landlord.id).map(profile => ({
                      id: profile.user_id,
                      name: profile.display_name || profile.email || 'Caretaker',
                      email: profile.email ?? undefined,
                    })),
                    caretakerAssignments: assignmentRows.filter(assignment => assignment.landlord_id === landlord.id && assignment.active).map(assignment => {
                      const caretaker = caretakerProfiles.get(assignment.caretaker_id)
                      return {
                        caretakerId: assignment.caretaker_id,
                        caretakerName: caretaker?.display_name || caretaker?.email || 'Caretaker',
                        caretakerEmail: caretaker?.email ?? undefined,
                        property: assignment.property_name,
                        unit: assignment.unit_name,
                      }
                    }),
                    updatedAt: row?.updated_at,
                  }
                }))
              }
            } else setPlatformLandlordWorkspaces([])
            setPlatformPortfolioLoading(false)
          } else setPlatformLandlordWorkspaces([])
        } else {
          setUsers([user])
          const accountError = accountLoadError?.message ?? 'Landlord profile/role query failed.'
          setCloudStatus(`Could not load team access: ${accountError}`)
          if (user.userType === 'Platform Administrator') {
            setPlatformLandlordWorkspaces([])
            setPlatformPortfolioError(`Could not load landlord accounts. Confirm supabase/user_hierarchy.sql and supabase/landlord_public_signup.sql ran successfully. Details: ${accountError}`)
            setPlatformPortfolioLoading(false)
          }
        }
      } else setUsers([user])
      const cloudData = (resolvedWorkspaceRow?.data ?? workspaceResult.data?.[0]?.data) as Partial<RentalWorkspaceData> | undefined
      if (cloudData) {
        const cloudUnits = cloudData.units ?? {}
        const cloudTenants = (cloudData.tenants ?? []).map(tenant => ({ ...tenant, unitDisplayName: tenant.unitDisplayName || cloudUnits[tenant.property]?.find(unit => unit.unit === tenant.unit)?.displayName || tenant.unit, rentAccountRef: tenant.rentAccountRef || makeRentAccountReference(), portalCode: tenant.portalCode || makeTenantPortalCode() }))
        setPropertyList(cloudData.properties ?? [])
        setUnitDetails(cloudUnits)
        setTenantList(cloudTenants)
        setSavedRows(cloudData.records ?? {})
        setInvoiceList(cloudData.invoices ?? [])
        setCompletedMaintenance(cloudData.maintenance ?? {})
        setExpenses(cloudData.expenses ?? [])
        setApplicants(cloudData.applicants ?? [])
        const settings = { ...defaultWorkspaceSettings, ...cloudData.settings }
        setWorkspaceName(settings.workspaceName)
        setPropertyGroup(settings.propertyGroup)
        setLandlordPaybill(settings.landlordPaybill || defaultWorkspaceSettings.landlordPaybill)
        setLandlordPaymentMethod(settings.landlordPaymentMethod ?? 'paybill')
        setLandlordTillNumber(settings.landlordTillNumber ?? '')
        setLandlordBankName(settings.landlordBankName ?? '')
        setLandlordBankAccountName(settings.landlordBankAccountName ?? '')
        setLandlordBankAccountNumber(settings.landlordBankAccountNumber ?? '')
        setDarkMode(settings.darkMode)
        setNotifEmail(settings.notifEmail)
        setNotifWeekly(settings.notifWeekly)
        setRentReminderEnabled(settings.rentReminderEnabled)
        setRentReminderDays(settings.rentReminderDays)
        setRentReminderChannel(settings.rentReminderChannel)
      } else if (user.userType === 'Caretaker') {
        setPropertyList([])
        setUnitDetails({})
        setTenantList([])
        setSavedRows({})
        setInvoiceList([])
        setCompletedMaintenance({})
        setExpenses([])
        setApplicants([])
        setCloudStatus('Your Landlord has not initialized the shared rental workspace yet.')
      } else {
        const legacyData = readLegacyWorkspace()
        legacyData.tenants = legacyData.tenants.map(tenant => ({ ...tenant, rentAccountRef: tenant.rentAccountRef || makeRentAccountReference(), portalCode: tenant.portalCode || makeTenantPortalCode() }))
        const hasLegacyData = legacyWorkspaceKeys.some(key => localStorage.getItem(key) !== null)
        if (hasLegacyData) {
          setPropertyList(legacyData.properties)
          setUnitDetails(legacyData.units)
          setTenantList(legacyData.tenants)
          setSavedRows(legacyData.records)
          setInvoiceList(legacyData.invoices)
          setCompletedMaintenance(legacyData.maintenance)
          setExpenses(legacyData.expenses)
          setApplicants(legacyData.applicants)
          const settings = { ...defaultWorkspaceSettings, ...legacyData.settings }
          setWorkspaceName(settings.workspaceName)
          setPropertyGroup(settings.propertyGroup)
          setLandlordPaybill(settings.landlordPaybill || defaultWorkspaceSettings.landlordPaybill)
          setLandlordPaymentMethod(settings.landlordPaymentMethod ?? 'paybill')
          setLandlordTillNumber(settings.landlordTillNumber ?? '')
          setLandlordBankName(settings.landlordBankName ?? '')
          setLandlordBankAccountName(settings.landlordBankAccountName ?? '')
          setLandlordBankAccountNumber(settings.landlordBankAccountNumber ?? '')
          setDarkMode(settings.darkMode)
          setNotifEmail(settings.notifEmail)
          setNotifWeekly(settings.notifWeekly)
          setRentReminderEnabled(settings.rentReminderEnabled)
          setRentReminderDays(settings.rentReminderDays)
          setRentReminderChannel(settings.rentReminderChannel)
          const { error } = await client.from('rental_workspaces').upsert({ owner_id: workspaceOwnerId, data: legacyData }, { onConflict: 'owner_id' })
          if (error) {
            setCloudStatus(`Legacy data migration failed: ${error.message}`)
            return
          }
          removeLegacyWorkspace()
          setCloudStatus('Legacy browser data moved to Supabase')
        } else setCloudStatus('Supabbase connected — workspace ready')
      }
      setCloudOwnerId(workspaceOwnerId)
      cloudHydrated.current = true
    }
    void hydrateCloudWorkspace()
    return () => { active = false }
  }, [authUser?.id])
  useEffect(() => {
    const client = supabase
    if (!client || !cloudHydrated.current || !cloudOwnerId) return
    const syncWorkspace = async () => {
      const data: RentalWorkspaceData = { properties: propertyList, units: unitDetails, tenants: tenantList, records: savedRows, invoices: invoiceList, maintenance: completedMaintenance, expenses, applicants, settings: { workspaceName, propertyGroup, darkMode, notifEmail, notifWeekly, rentReminderEnabled, rentReminderDays, rentReminderChannel, landlordPaybill, landlordPaymentMethod, landlordTillNumber, landlordBankName, landlordBankAccountName, landlordBankAccountNumber } }
      const { error } = await client.from('rental_workspaces').upsert({ owner_id: cloudOwnerId, data }, { onConflict: 'owner_id' })
      if (error) setCloudStatus(`Cloud error: ${error.message}`)
      else {
        let accountSyncMessage = ''
        if (effectiveRentPaybill) {
          const accountRows = tenantList.filter(tenant => tenant.rentAccountRef).map(tenant => ({
            account_reference: tenant.rentAccountRef!,
            paybill_reference: getPaybillAccountReference(tenant),
            owner_id: cloudOwnerId,
            tenant_key: `${tenant.property}::${tenant.unit}`,
            tenant_name: tenant.name,
            property_name: tenant.property,
            unit_name: tenant.unit,
            phone: tenant.phone ?? null,
            active: true,
            updated_at: new Date().toISOString(),
          }))
          const { data: existingAccounts, error: existingError } = await client.from('rent_payment_accounts').select('account_reference').eq('owner_id', cloudOwnerId)
          if (existingError) accountSyncMessage = `Paybill reference sync error: ${existingError.message}`
          else {
            const activeReferences = new Set(accountRows.map(account => account.account_reference))
            const removedReferences = (existingAccounts ?? []).map(account => account.account_reference).filter(reference => !activeReferences.has(reference))
            if (removedReferences.length) {
              const { error: deactivateError } = await client.from('rent_payment_accounts').update({ active: false, paybill_reference: null, updated_at: new Date().toISOString() }).in('account_reference', removedReferences)
              if (deactivateError) accountSyncMessage = `Could not deactivate removed tenant references: ${deactivateError.message}`
            }
            if (accountRows.length) {
              const { error: accountError } = await client.from('rent_payment_accounts').upsert(accountRows, { onConflict: 'account_reference' })
              if (accountError) accountSyncMessage = `Paybill reference sync error: ${accountError.message}`
            }
          }
        }
        setCloudStatus(accountSyncMessage || 'Cloud synced just now')
        removeLegacyWorkspace()
      }
    }
    const timer = window.setTimeout(syncWorkspace, 700)
    return () => window.clearTimeout(timer)
  }, [cloudOwnerId, propertyList, unitDetails, tenantList, savedRows, invoiceList, completedMaintenance, expenses, applicants, workspaceName, propertyGroup, darkMode, notifEmail, notifWeekly, rentReminderEnabled, rentReminderDays, rentReminderChannel, landlordPaybill])
  useEffect(() => {
    const client = supabase
    if (!client || !cloudOwnerId) return
    let active = true
    const loadRentPayments = async () => {
      const { data, error } = await client.from('rent_payments')
        .select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name')
        .eq('owner_id', cloudOwnerId)
        .order('transacted_at', { ascending: false })
      if (!active) return
      if (error) setCloudStatus(`Rent payments unavailable: ${error.message}`)
      else setDirectRentPayments(data ?? [])
    }
    void loadRentPayments()
    return () => { active = false }
  }, [cloudOwnerId])
  const filteredProperties = useMemo(() => propertyList.filter((property) => property.name.toLowerCase().includes(query.toLowerCase())), [propertyList, query])
  const removeTenant = (tenant: TenantRecord) => {
    if (!window.confirm(`Remove ${tenant.name} from Unit ${tenant.unit}?`)) return
    setTenantList((current) => current.filter((item) => !(item.name === tenant.name && item.unit === tenant.unit && item.property === tenant.property)))
    setUnitDetails((current) => ({ ...current, [tenant.property]: (current[tenant.property] ?? []).map((unit) => unit.unit === tenant.unit ? { ...unit, tenant: 'Vacant', status: 'Vacant' } : unit) }))
    setPropertyList((current) => current.map((property) => property.name === tenant.property ? { ...property, occupied: Math.max(property.occupied - 1, 0), status: property.occupied - 1 > 0 ? 'Healthy' : 'Attention' } : property))
  }
  // Delete property
  const deleteProperty = (name: string) => {
    if (!window.confirm(`Delete "${name}" and all its units? This cannot be undone.`)) return
    setPropertyList(c => c.filter(p => p.name !== name))
    setUnitDetails(c => { const next = { ...c }; delete next[name]; return next })
    setTenantList(c => c.filter(t => t.property !== name))
  }
  // Save edited tenant
  const saveEditTenant = (updated: TenantRecord, original: TenantRecord) => {
    setTenantList(c => c.map(t => t.name === original.name && t.unit === original.unit && t.property === original.property ? updated : t))
    setUnitDetails(c => ({ ...c, [updated.property]: (c[updated.property] ?? []).map(u => u.unit === updated.unit ? { ...u, tenant: updated.name } : u) }))
    setEditingTenant(null)
  }
  // Delete payment
  const deletePayment = (idx: number) => {
    if (!window.confirm('Delete this payment record?')) return
    setSavedRows(c => ({ ...c, Payments: (c.Payments ?? []).filter((_, i) => i !== idx) }))
  }
  // Save edited payment
  const saveEditPayment = (newRow: string, idx: number) => {
    setSavedRows(c => ({ ...c, Payments: (c.Payments ?? []).map((r, i) => i === idx ? newRow : r) }))
    setEditingPaymentIdx(null)
  }
  // Delete maintenance
  const deleteMaintenance = (idx: number) => {
    if (!window.confirm('Delete this maintenance request?')) return
    const row = (savedRows.Maintenance ?? [])[idx]
    setSavedRows(c => ({ ...c, Maintenance: (c.Maintenance ?? []).filter((_, i) => i !== idx) }))
    setCompletedMaintenance(c => { const next = { ...c }; delete next[row]; return next })
  }
  // Save edited maintenance
  const saveEditMaintenance = (newRow: string, idx: number) => {
    const oldRow = (savedRows.Maintenance ?? [])[idx]
    setSavedRows(c => ({ ...c, Maintenance: (c.Maintenance ?? []).map((r, i) => i === idx ? newRow : r) }))
    setCompletedMaintenance(c => {
      if (c[oldRow]) { const next = { ...c }; delete next[oldRow]; next[newRow] = true; return next }
      return c
    })
    setEditingMaintenanceIdx(null)
  }
  const markMaintenanceDone = (idx: number) => {
    const row = (savedRows.Maintenance ?? [])[idx]
    if (row) setCompletedMaintenance(current => ({ ...current, [row]: true }))
  }
  // Fix isPaid — month-aware: check if payment period matches current month or specific tenant+unit
  const getCurrentPeriod = () => { const d = new Date(); return `${d.toLocaleString('en-KE', { month: 'long' })} ${d.getFullYear()}` }
  const isPaidForPeriod = (tenant: TenantRecord, period?: string) => {
    const target = period ?? getCurrentPeriod()
    const isManualPaymentRecorded = (savedRows.Payments ?? []).some(row => {
      const parts = row.split(' · ')
      const rowProperty = parts[3] ?? ''
      const rowUnit = parts[2]?.replace('House ', '') ?? ''
      const rowPeriod = parts[5] ?? ''
      return rowProperty === tenant.property && (rowUnit === tenant.unit || row.includes(tenant.unit)) && (rowPeriod === target || rowPeriod === '')
    })
    const isPaybillPaymentRecorded = directRentPayments.some(payment => {
      const paidPeriod = new Date(payment.transacted_at).toLocaleString('en-KE', { month: 'long', year: 'numeric' })
      return payment.property_name === tenant.property && payment.unit_name === tenant.unit && paidPeriod === target
    })
    return isManualPaymentRecorded || isPaybillPaymentRecorded
  }
  const getRentDueDateForTenant = (tenant: TenantRecord) => {
    return getNextMonthlyRentDueDate(tenant.movedIn)
  }
  const rentReminderQueue = useMemo(() => {
    if (!rentReminderEnabled) return []
    return tenantList.filter((tenant) => !isPaidForPeriod(tenant)).map((tenant) => {
      const dueDate = getRentDueDateForTenant(tenant)
      const now = new Date(); now.setHours(0, 0, 0, 0)
      const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      return {
        id: `${tenant.property}-${tenant.unit}`,
        tenant,
        diffDays,
        status: diffDays <= 0 ? 'Overdue' : diffDays <= rentReminderDays ? 'Due soon' : 'Due this month',
        dueLabel: dueDate.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' }),
      }
    }).sort((a, b) => a.diffDays - b.diffDays)
  }, [tenantList, rentReminderEnabled, rentReminderDays])
  const pendingWaterBillInvoices = useMemo(() => tenantList.flatMap(tenant => {
    const cycle = getCurrentRentCycle(tenant.movedIn)
    if (!cycle) return []
    const updatedAt = tenant.waterBillUpdatedAt ? new Date(tenant.waterBillUpdatedAt) : null
    if (updatedAt && !Number.isNaN(updatedAt.getTime()) && updatedAt >= cycle.periodStart) return []
    return [{ id: `${tenant.property}-${tenant.unit}`, tenant, dueLabel: cycle.dueDate.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' }) }]
  }), [tenantList])
  const sendRentReminder = (tenant: TenantRecord) => {
    const dueDate = getNextMonthlyRentDueDate(tenant.movedIn).toLocaleDateString('en-KE', { month: 'long', day: 'numeric', year: 'numeric' })
    const message = buildRentWhatsAppMessage({ workspaceName, tenant, rent: tenant.rent, waterBill: tenant.waterBill ?? '0', paymentDetails: landlordPaymentDetails, dueDate })
    const cleanedPhone = normalizeWhatsAppPhone(tenant.phone)
    const encodedMessage = encodeURIComponent(message)
    const reminderUrl = rentReminderChannel === 'Email' && tenant.email ? `mailto:${tenant.email}?subject=${encodeURIComponent('Rent reminder')}&body=${encodedMessage}` : `https://wa.me/${cleanedPhone}?text=${encodedMessage}`
    window.open(reminderUrl, '_blank', 'noopener,noreferrer')
  }
  const generateInvoice = (tenant: TenantRecord) => {
    const invoice: InvoiceRecord = { id: `INV-${tenant.unit.replace(/\s/g, '')}-${Date.now().toString().slice(-6)}`, tenantName: tenant.name, email: tenant.email, property: tenant.property, unit: tenant.unit, unitType: tenant.unitType, rent: tenant.rent, waterBill: tenant.waterBill ?? '0', issuedAt: new Date().toISOString(), movedIn: tenant.movedIn }
    setInvoiceList((current) => {
      // If an invoice already exists for this tenant+unit, replace it (one invoice per tenant)
      const exists = current.some(inv => inv.unit === tenant.unit && inv.property === tenant.property)
      if (exists) return current.map(inv => inv.unit === tenant.unit && inv.property === tenant.property ? invoice : inv)
      return [invoice, ...current]
    })
    setActiveInvoice(invoice)
    setInvoiceTenant(tenant)
  }
  const persistCloudUserAccess = async (updatedUser: AccessUser) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.rpc('admin_update_user_access', {
      p_user_id: updatedUser.id,
      p_role: toDatabaseRole(updatedUser.role),
      p_active: updatedUser.active,
      p_display_name: updatedUser.name,
      p_phone: updatedUser.phone ?? '',
      p_user_type: toDatabaseUserType(updatedUser.userType),
    })
    if (error) { setCloudStatus(`Could not update account: ${error.message}`); throw new Error(error.message) }
    setUsers(current => current.map(user => user.id === updatedUser.id ? updatedUser : user))
    if (sessionUser?.id === updatedUser.id) setSessionUser(updatedUser)
    setCloudStatus('Account settings saved to Supabase')
  }
  const reviewCloudSubscriptionPayment = async (requestId: string, approve: boolean) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const reviewUser = users.find(user => user.subscriptionRequest?.id === requestId)
    if (!reviewUser?.subscriptionRequest) throw new Error('This pending subscription payment could not be found. Refresh the page and try again.')
    const { data, error } = await supabase.rpc('review_admin_subscription_payment', { p_request_id: requestId, p_approve: approve })
    if (error) {
      setCloudStatus(`Payment review failed: ${error.message}`)
      throw new Error(error.message)
    }
    const result = data as { subscription?: { plan: string; status: string; starts_on: string; expires_on: string; amount: number } | null }
    const updatedUser: AccessUser = {
      ...reviewUser,
      subscriptionRequest: { ...reviewUser.subscriptionRequest, status: approve ? 'approved' : 'rejected', reviewedAt: new Date().toISOString() },
    }
    setUsers(current => current.map(user => user.id === updatedUser.id ? updatedUser : user))
    let subscription = reviewUser.subscription
    if (approve) {
      const activatedSubscription = result.subscription
      if (!activatedSubscription) {
        const message = 'Payment was approved, but the review RPC did not return the activated subscription. Rerun supabase/subscription_payment_admin_queue.sql.'
        setCloudStatus(message)
        throw new Error(message)
      }
      subscription = { plan: activatedSubscription.plan as SubscriptionPlan, status: activatedSubscription.status as SubscriptionStatus, startDate: activatedSubscription.starts_on, expiryDate: activatedSubscription.expires_on, amount: activatedSubscription.amount }
    }
    updatedUser.subscription = subscription
    setUsers(current => current.map(user => user.id === updatedUser.id ? updatedUser : user))
    if (sessionUser?.id === updatedUser.id) setSessionUser(updatedUser)
    setCloudStatus(approve ? 'Subscription payment verified and activated' : 'Subscription payment request rejected')
  }
  const loadCloudSubscriptionPaymentHistory = useCallback(async (status: SubscriptionPaymentHistoryFilter, page: number, pageSize: number) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { data, error } = await supabase.rpc('get_admin_subscription_payment_history', {
      p_status: status,
      p_page: page,
      p_page_size: pageSize,
    })
    if (error) {
      setCloudStatus(`Payment history unavailable: ${error.message}`)
      throw new Error(error.message)
    }
    if (!data || typeof data !== 'object' || !('total_count' in data) || !('requests' in data)) {
      throw new Error('Supabase returned an invalid payment history response.')
    }
    const result = data as AdminSubscriptionPaymentHistoryResult
    if (!Number.isInteger(result.total_count) || result.total_count < 0 || !Array.isArray(result.requests)) {
      throw new Error('Supabase returned an invalid payment history response.')
    }
    return result
  }, [])
  const registerRentPaybillCallbacks = async () => {
    if (!supabase) throw new Error('Supabase is not configured.')
    if (!rentPaybill) throw new Error('Set VITE_MPESA_RENT_PAYBILL in .env and restart Vite first.')
    const { data, error } = await supabase.functions.invoke('mpesa-register-c2b', { body: {} })
    if (error) {
      let detail = error.message
      const response = (error as { context?: unknown }).context
      if (response instanceof Response) {
        try {
          const body = await response.clone().json()
          detail = body.error || body.message || detail
        } catch {
          const bodyText = await response.clone().text().catch(() => '')
          if (bodyText) detail = bodyText
        }
      }
      if (/404|not found/i.test(detail)) detail = 'Supabase Edge Function "mpesa-register-c2b" was not found. Confirm the CLI is linked to the correct project and deploy it with: supabase functions deploy mpesa-register-c2b'
      if (/failed to send a request|failed to fetch|networkerror/i.test(detail)) detail = 'The browser could not reach the callback registration function. Check the Supabase project URL, network connection, and function deployment, then retry.'
      throw new Error(detail)
    }
    setCloudStatus(data?.message ?? 'Safaricom Paybill callbacks registered')
  }
  useEffect(() => {
    const client = supabase
    if (!client || sessionUser?.role !== 'Administrator' || !authUser) return
    let active = true
    const refreshPendingRequests = async () => {
      const { data, error } = await client.rpc('get_admin_subscription_payment_queue')
      if (!active) return
      if (error) {
        setCloudStatus(`Payment requests unavailable. Run supabase/subscription_payment_admin_queue.sql. Details: ${error.message}`)
        return
      }
      const requests = (data ?? []) as AdminSubscriptionPaymentQueueRow[]
      setUsers(current => {
        const refreshed = new Map(current.map(user => [user.id, user]))
        for (const [userId, user] of refreshed) {
          if (user.subscriptionRequest?.status === 'pending') {
            refreshed.set(userId, { ...user, subscriptionRequest: undefined })
          }
        }
        requests.forEach(request => {
          const previous = refreshed.get(request.user_id)
          refreshed.set(request.user_id, {
            ...previous,
            id: request.user_id,
            name: request.profile_name || request.profile_email || 'User',
            username: request.profile_email || request.user_id,
            email: request.profile_email ?? undefined,
            phone: request.profile_phone ?? undefined,
            userType: mapDatabaseUserType(request.user_type),
            role: mapDatabaseRole(request.account_role),
            active: request.account_active,
            subscriptionRequest: { id: request.request_id, plan: request.plan, amount: request.amount, mpesaCode: request.mpesa_code, paymentMethod: request.payment_method, status: request.status, submittedAt: request.submitted_at, reviewedAt: request.reviewed_at ?? undefined },
          })
        })
        return [...refreshed.values()]
      })
    }
    const refreshPublicLandlordSignups = async () => {
      if (sessionUser.userType !== 'Platform Administrator') return
      const { data: profiles, error } = await client.from('profiles')
        .select('user_id, display_name, email, phone, user_type, signup_status, requested_plan')
        .eq('user_type', 'landlord')
        .is('created_by', null)
      if (!active) return
      if (error) {
        setCloudStatus(`Could not refresh landlord registrations. Run supabase/landlord_public_signup.sql. Details: ${error.message}`)
        return
      }
      if (!profiles?.length) return
      const { data: roles, error: rolesError } = await client.from('user_roles')
        .select('user_id, role, active')
        .in('user_id', profiles.map(profile => profile.user_id))
      if (!active) return
      if (rolesError || !roles) {
        setCloudStatus(`Could not refresh landlord registration roles: ${rolesError?.message ?? 'No role data returned.'}`)
        return
      }
      setUsers(current => {
        const refreshed = new Map(current.map(user => [user.id, user]))
        profiles.forEach(profile => {
          const roleRecord = roles.find(role => role.user_id === profile.user_id)
          if (!roleRecord) return
          const previous = refreshed.get(profile.user_id)
          refreshed.set(profile.user_id, {
            ...previous,
            id: profile.user_id,
            name: profile.display_name || profile.email || 'Landlord',
            username: profile.email || profile.user_id,
            email: profile.email ?? undefined,
            phone: profile.phone ?? undefined,
            userType: 'Landlord',
            role: mapDatabaseRole(roleRecord.role),
            active: roleRecord.active,
            signupStatus: profile.signup_status as LandlordSignupStatus,
            requestedPlan: profile.requested_plan as PublicLandlordPlan | null ?? undefined,
          })
        })
        return [...refreshed.values()]
      })
    }
    const refreshAdminQueues = () => {
      void refreshPendingRequests()
      void refreshPublicLandlordSignups()
    }
    refreshAdminQueues()
    const timer = window.setInterval(refreshAdminQueues, 20000)
    return () => { active = false; window.clearInterval(timer) }
  }, [authUser?.id, sessionUser?.role, sessionUser?.userType])
  useEffect(() => {
    const client = supabase
    if (!client || !authUser || !sessionUser) return
    let active = true
    const refreshSubscription = async () => {
      const [subscriptionResult, requestResult] = await Promise.all([
        client.from('subscriptions').select('plan, status, starts_on, expires_on, amount').eq('user_id', authUser.id).maybeSingle(),
        client.from('subscription_payment_requests').select('id, plan, amount, mpesa_code, payment_method, status, submitted_at, reviewed_at').eq('user_id', authUser.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      if (!active || subscriptionResult.error || requestResult.error) return
      const subscription = subscriptionResult.data ? {
        plan: subscriptionResult.data.plan as SubscriptionPlan,
        status: subscriptionResult.data.status as SubscriptionStatus,
        startDate: subscriptionResult.data.starts_on,
        expiryDate: subscriptionResult.data.expires_on,
        amount: subscriptionResult.data.amount,
      } : undefined
      const request = requestResult.data ? {
        id: requestResult.data.id,
        plan: requestResult.data.plan as SubscriptionRequestPlan,
        amount: requestResult.data.amount,
        mpesaCode: requestResult.data.mpesa_code,
        paymentMethod: requestResult.data.payment_method as LandlordPaymentMethod,
        status: requestResult.data.status as 'pending' | 'approved' | 'rejected',
        submittedAt: requestResult.data.submitted_at,
        reviewedAt: requestResult.data.reviewed_at ?? undefined,
      } : undefined
      setSessionUser(current => current && current.id === authUser.id ? { ...current, subscription, subscriptionRequest: request } : current)
      const { data: rentPayments, error: rentPaymentsError } = await client.from('rent_payments')
        .select('id, owner_id, account_reference, mpesa_receipt, amount, transacted_at, phone, tenant_name, property_name, unit_name')
        .eq('owner_id', cloudOwnerId ?? authUser.id)
        .order('transacted_at', { ascending: false })
      if (active && !rentPaymentsError) setDirectRentPayments(rentPayments ?? [])
    }
    void refreshSubscription()
    const timer = window.setInterval(refreshSubscription, 20000)
    return () => { active = false; window.clearInterval(timer) }
  }, [authUser?.id, sessionUser?.id, cloudOwnerId])
  const totalUnits = propertyList.reduce((total, property) => total + property.units, 0)
  const occupiedUnits = propertyList.reduce((total, property) => total + property.occupied, 0)
  const monthlyRentRoll = propertyList.reduce((total, property) => total + (Number(property.income.replace(/[^0-9.]/g, '')) || 0), 0)
  const collectedPayments = (savedRows.Payments ?? []).reduce((total, row) => total + (Number(row.split(' · ')[0].replace(/[^0-9.]/g, '')) || 0), 0) + directRentPayments.reduce((total, payment) => total + Number(payment.amount || 0), 0)
  const openMaintenance = (savedRows.Maintenance ?? []).filter((row) => !completedMaintenance[row]).length
  const vacantUnits = Math.max(totalUnits - occupiedUnits, 0)
  const collectionRate = monthlyRentRoll ? Math.min(Math.round(collectedPayments / monthlyRentRoll * 100), 100) : 0
  const leaseCutoff = new Date()
  leaseCutoff.setDate(leaseCutoff.getDate() + 60)
  const upcomingLeases = tenantList.filter((tenant) => tenant.leaseEnd && new Date(`${tenant.leaseEnd}T00:00:00`) <= leaseCutoff).sort((a, b) => (a.leaseEnd ?? '').localeCompare(b.leaseEnd ?? ''))
  const overviewActivities = [
    ...(savedRows.Payments ?? []).map((row) => ({ icon: CircleDollarSign, title: 'Payment recorded', detail: row, time: row.split(' · ')[4] || 'Recently', tone: 'green' })),
    ...(savedRows.Maintenance ?? []).map((row) => ({ icon: Wrench, title: 'Maintenance request', detail: row, time: 'Recently', tone: 'orange' })),
    ...invoiceList.map((invoice) => ({ icon: FileText, title: 'Invoice generated', detail: `${invoice.tenantName} · Unit ${invoice.unit}`, time: new Date(invoice.issuedAt).toLocaleDateString('en-KE'), tone: 'blue' })),
  ].sort((a, b) => b.time.localeCompare(a.time))
  const overviewPageSize = 5
  const propertyPageSize = 10
  const revenueRows = (savedRows.Payments ?? []).slice().reverse()
  const revenuePageCount = Math.max(1, Math.ceil(revenueRows.length / overviewPageSize))
  const activityPageCount = Math.max(1, Math.ceil(overviewActivities.length / overviewPageSize))
  const reminderPageCount = Math.max(1, Math.ceil(rentReminderQueue.length / overviewPageSize))
  const propertyPageCount = Math.max(1, Math.ceil(filteredProperties.length / propertyPageSize))
  const visibleRevenueRows = revenueRows.slice((Math.min(overviewRevenuePage, revenuePageCount) - 1) * overviewPageSize, Math.min(overviewRevenuePage, revenuePageCount) * overviewPageSize)
  const visibleActivities = overviewActivities.slice((Math.min(overviewActivityPage, activityPageCount) - 1) * overviewPageSize, Math.min(overviewActivityPage, activityPageCount) * overviewPageSize)
  const visibleReminders = rentReminderQueue.slice((Math.min(overviewReminderPage, reminderPageCount) - 1) * overviewPageSize, Math.min(overviewReminderPage, reminderPageCount) * overviewPageSize)
  const visibleOverviewProperties = filteredProperties.slice((Math.min(overviewPropertyPage, propertyPageCount) - 1) * propertyPageSize, Math.min(overviewPropertyPage, propertyPageCount) * propertyPageSize)
  // ── Role-based access control ──────────────────────────────
  const role = sessionUser?.role ?? 'Viewer'
  const isPlatformAdministrator = sessionUser?.userType === 'Platform Administrator' && sessionUser.role === 'Administrator'
  const canAccessSystem = Boolean(sessionUser)
  const can = {
    viewProperties:    true,
    addProperty:       role === 'Administrator' || role === 'Manager',
    viewTenants:       true,
    addTenant:         role === 'Administrator' || role === 'Manager',
    removeTenantAccess:role === 'Administrator' || role === 'Manager',
    viewMaintenance:   role !== 'Accountant',
    addMaintenance:    role === 'Administrator' || role === 'Manager' || role === 'Caretaker',
    viewPayments:      role !== 'Caretaker',
    addPayment:        role === 'Administrator' || role === 'Manager' || role === 'Accountant',
    viewOperations:    role === 'Administrator' || role === 'Manager' || role === 'Accountant',
    viewDocuments:     role !== 'Caretaker',
    viewSettings:      role === 'Administrator',
    addDocument:       role === 'Administrator' || role === 'Manager' || role === 'Accountant',
  }
  const navItems = isPlatformAdministrator ? [
    { label: 'Overview', icon: LayoutDashboard },
  ] : [
    { label: 'Overview',     icon: LayoutDashboard },
    { label: 'Properties',   icon: Building2 },
    { label: 'Tenants',      icon: Users },
    { label: 'Tenant portal', icon: Home },
    ...(can.viewMaintenance  ? [{ label: 'Maintenance', icon: Wrench, count: openMaintenance || undefined }] : []),
    ...(can.viewPayments     ? [{ label: 'Payments',    icon: CircleDollarSign }] : []),
    ...(can.viewOperations   ? [{ label: 'Operations',  icon: WalletCards }] : []),
    ...(can.viewDocuments    ? [{ label: 'Documents',   icon: FileText }] : []),
  ]
  const initials = sessionUser?.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() ?? ''
  const today = new Intl.DateTimeFormat('en-KE', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date())
  const navigate = (section: string) => { setActiveSection(section); setSelectedProperty(null) }
  const openTenantPublicPage = () => {
    const next = '/tenant'
    window.history.pushState({}, '', next)
    setHomePage(false)
    setTenantPublicView(true)
    setLandlordSignupPage(false)
  }
  const openHomePage = () => {
    window.history.pushState({}, '', '/')
    setHomePage(true)
    setTenantPublicView(false)
    setLandlordSignupPage(false)
  }
  const openLandlordSignupPage = () => {
    window.history.pushState({}, '', '/landlord-signup')
    setHomePage(false)
    setTenantPublicView(false)
    setLandlordSignupPage(true)
  }
  const handleSaveWorkspace = (name: string, group: string, paymentDetails: LandlordPaymentDetails) => {
    setWorkspaceName(name)
    setPropertyGroup(group)
    setLandlordPaybill(paymentDetails.paybillNumber)
    setLandlordPaymentMethod(paymentDetails.method)
    setLandlordTillNumber(paymentDetails.tillNumber)
    setLandlordBankName(paymentDetails.bankName)
    setLandlordBankAccountName(paymentDetails.bankAccountName)
    setLandlordBankAccountNumber(paymentDetails.bankAccountNumber)
    localStorage.setItem('moha-landlord-paybill', JSON.stringify(paymentDetails.paybillNumber.trim()))
    localStorage.setItem('moha-landlord-payment-method', JSON.stringify(paymentDetails.method))
    localStorage.setItem('moha-landlord-till-number', JSON.stringify(paymentDetails.tillNumber.trim()))
    localStorage.setItem('moha-landlord-bank-name', JSON.stringify(paymentDetails.bankName.trim()))
    localStorage.setItem('moha-landlord-bank-account-name', JSON.stringify(paymentDetails.bankAccountName.trim()))
    localStorage.setItem('moha-landlord-bank-account-number', JSON.stringify(paymentDetails.bankAccountNumber.trim()))
  }
  const openRoleLoginPage = (role: 'Landlord' | 'Administrator' | 'Caretaker') => {
    const next = role === 'Administrator' ? '/admin' : role === 'Caretaker' ? '/caretaker' : '/landlord'
    window.history.pushState({}, '', next)
    setHomePage(false)
    setTenantPublicView(false)
    setLandlordSignupPage(false)
  }
  const signOut = () => { if (supabase) void supabase.auth.signOut() }
  const copyTenantPortalCode = async (tenant: TenantRecord) => {
    if (!tenant.portalCode) return
    try {
      await navigator.clipboard.writeText(tenant.portalCode)
      setCopiedPortalCode(tenant.portalCode)
      window.setTimeout(() => setCopiedPortalCode(''), 1800)
    } catch {
      setCopiedPortalCode('')
      setCloudStatus('Clipboard unavailable. Open the tenant profile to select the portal code.')
    }
  }
  const saveRecoveredPassword = async (password: string) => {
    if (!supabase) throw new Error('Supabase is not configured.')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw new Error(error.message)
    setShowPasswordRecovery(false)
    setAuthMessage('Password updated. Sign in with your new password.')
    await supabase.auth.signOut()
  }

  const submitTenantPortalLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = tenantPortalForm.email.trim().toLowerCase()
    const code = tenantPortalForm.portalCode.trim()
    const tenant = tenantList.find(item => item.email?.trim().toLowerCase() === email && (item.portalCode ?? '').trim().toLowerCase() === code.toLowerCase())
    if (!tenant) {
      setTenantPortalError('Invalid tenant email or portal code. Use the code shared by your landlord.')
      return
    }
    setTenantPortalSession({ name: tenant.name, property: tenant.property, unit: tenant.unit, email: tenant.email ?? email, portalCode: tenant.portalCode ?? code })
    setTenantPublicView(false)
    setTenantPortalError('')
  }

  const tenantPortalStatement = useMemo(() => {
    if (!tenantPortalSession) return null
    const tenant = tenantList.find(item => item.name === tenantPortalSession.name && item.property === tenantPortalSession.property && item.unit === tenantPortalSession.unit)
    if (!tenant) return null
    const directMatches = directRentPayments.filter(payment => payment.property_name === tenant.property && payment.unit_name === tenant.unit)
    const manualMatches = (savedRows.Payments ?? []).filter(row => {
      const parts = row.split(' · ')
      const rowProperty = parts[3] ?? ''
      const rowUnit = parts[2]?.replace('House ', '') ?? ''
      return rowProperty === tenant.property && (rowUnit === tenant.unit || row.includes(tenant.unit))
    })
    const history = [
      ...manualMatches.map((row) => {
        const parts = row.split(' · ')
        const amount = Number((parts[0] ?? '').replace(/[^0-9.]/g, '')) || 0
        return { label: parts[6] || 'Manual payment', amount, date: parts[4] || new Date().toISOString().slice(0, 10), method: parts[5] || 'Manual' }
      }),
      ...directMatches.map(payment => ({ label: payment.mpesa_receipt || 'M-Pesa payment', amount: Number(payment.amount || 0), date: new Date(payment.transacted_at).toISOString().slice(0, 10), method: 'M-Pesa' })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const amountDue = Number((tenant.rent || '0').replace(/[^0-9.]/g, '')) || 0
    const totalPaid = history.reduce((sum, item) => sum + item.amount, 0)
    return { tenant, amountDue, totalPaid, balance: Math.max(amountDue - totalPaid, 0), history }
  }, [tenantPortalSession, tenantList, directRentPayments, savedRows.Payments])
  
  // Check subscription status (informational only - doesn't block access)
  const checkSubscription = () => {
    if (!sessionUser?.subscription) return { isValid: true, daysLeft: 999, isExpiring: false }
    const { status, expiryDate } = sessionUser.subscription
    const expiry = new Date(expiryDate)
    const now = new Date()
    const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    const isValid = (status === 'active' || status === 'trial') && daysLeft > 0
    const isExpiring = isValid && daysLeft <= 7
    return { isValid, daysLeft, status, isExpiring }
  }
  
  const subStatus = checkSubscription()
  const activateTestSubscription = async () => {
    if (!supabase || !sessionUser) {
      setSubscriptionFeedback('Supabase is not configured.')
      return
    }
    if (sessionUser.userType !== 'Landlord' || sessionUser.subscription || sessionUser.subscriptionRequest?.status === 'pending') return
    setSubscriptionFeedback('Starting your one-month test plan...')
    const { data, error } = await supabase.rpc('activate_test_subscription')
    if (error || !data) {
      setSubscriptionFeedback(error?.message ?? 'Could not start the test plan.')
      return
    }
    const trial = data as unknown as { plan: string; status: string; starts_on: string; expires_on: string; amount: number }
    const updatedUser: AccessUser = {
      ...sessionUser,
      subscription: { plan: 'test', status: 'trial', startDate: trial.starts_on, expiryDate: trial.expires_on, amount: 0 },
    }
    setSessionUser(updatedUser)
    setUsers(current => current.map(user => user.id === updatedUser.id ? updatedUser : user))
    setShowSubscriptionModal(false)
    setSubscriptionFeedback('')
  }
  const subscriptionPaymentDestinationConfigured = subscriptionPaymentDetails.method === 'paybill'
    ? Boolean(subscriptionPaymentDetails.paybillNumber.trim())
    : subscriptionPaymentDetails.method === 'till'
      ? Boolean(subscriptionPaymentDetails.tillNumber.trim())
      : Boolean(subscriptionPaymentDetails.bankName.trim() && subscriptionPaymentDetails.bankAccountName.trim() && subscriptionPaymentDetails.bankAccountNumber.trim())

  useEffect(() => {
    const updatePublicRoute = () => {
      const path = window.location.pathname
      setHomePage(path === '/')
      setLandlordSignupPage(path === '/landlord-signup')
      setTenantPublicView(['/', '/landlord', '/admin', '/administrator', '/caretaker'].includes(path) ? false : ['/tenant', '/tenants', '/portal'].includes(path))
    }
    updatePublicRoute()
    window.addEventListener('popstate', updatePublicRoute)
    return () => window.removeEventListener('popstate', updatePublicRoute)
  }, [])

  useEffect(() => {
    if (!authUser && !tenantPortalForm.email && !tenantPortalForm.portalCode && tenantList.length === 0 && propertyList.length === 0) {
      const demo = createDemoTenantSample()
      setPropertyList(demo.propertyList)
      setUnitDetails(demo.unitDetails)
      setTenantList(demo.tenantList)
      setSavedRows(current => ({ ...current, Payments: [...(current.Payments ?? []), ...demo.payments] }))
      setTenantPortalForm({ email: demo.credentials.email, portalCode: demo.credentials.portalCode })
    }
  }, [authUser?.id, tenantList.length, propertyList.length, tenantPortalForm.email, tenantPortalForm.portalCode])

  if (showPasswordRecovery) return <PasswordRecoveryView darkMode={darkMode} onSave={saveRecoveredPassword} />
  if (pendingLandlordApproval) return <LandlordApprovalStatusPage workspaceName={workspaceName} registration={pendingLandlordApproval} onRefresh={() => window.location.reload()} onBack={signOut} />
  if (tenantPortalSession && tenantPortalStatement) return <TenantStatementPage tenant={tenantPortalStatement.tenant} workspaceName={workspaceName} propertyGroup={propertyGroup} statement={tenantPortalStatement} onBack={() => { setTenantPortalSession(null); setTenantPublicView(false) }} onSendReminder={(message) => {
    const phone = tenantPortalStatement.tenant.phone?.replace(/\D/g, '') || ''
    const reminderText = message || `Hello ${tenantPortalStatement.tenant.name}, this is a reminder from ${workspaceName}. Your rent balance is KSh ${tenantPortalStatement.balance.toLocaleString()} for ${tenantPortalStatement.tenant.property}, Unit ${getTenantUnitLabel(tenantPortalStatement.tenant)}.`
    const url = tenantPortalStatement.tenant.email ? `mailto:${tenantPortalStatement.tenant.email}?subject=${encodeURIComponent('Rent reminder')}&body=${encodeURIComponent(reminderText)}` : `https://wa.me/${phone}?text=${encodeURIComponent(reminderText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }} />
  if (!authReady) return <main className="login-shell"><p>Connecting to Supabase...</p></main>
  if (authUser && !sessionUser) return <main className="login-shell"><p>Loading Supabase profile...</p></main>
  if (authUser && sessionUser && !cloudOwnerId) return <main className="login-shell"><section className="login-card"><p className="login-kicker">SUPABASE WORKSPACE</p><h1>Workspace unavailable<span>.</span></h1><p className="login-copy">{cloudStatus}</p><button type="button" className="login-button" onClick={signOut}>Sign out</button></section></main>
  if (landlordSignupPage && !sessionUser) return <PublicLandlordSignupPage workspaceName={workspaceName} onBack={openHomePage} />
  if (homePage && !sessionUser) return <PortalHomePage workspaceName={workspaceName} onOpenRolePage={openRoleLoginPage} onOpenTenantPortal={openTenantPublicPage} onOpenLandlordSignup={openLandlordSignupPage} />
  if (tenantPublicView) return <TenantPublicLoginPage darkMode={darkMode} workspaceName={workspaceName} tenantList={tenantList} tenantPortalForm={tenantPortalForm} tenantPortalError={tenantPortalError} onTenantPortalFormChange={(key, value) => setTenantPortalForm(current => ({ ...current, [key]: value }))} onTenantPortalSubmit={submitTenantPortalLogin} onBackToHome={openHomePage} />
  if (!sessionUser) return <LoginView darkMode={darkMode} workspaceName={workspaceName} authMessage={authMessage} onOpenTenantPortal={openTenantPublicPage} onOpenRolePage={openRoleLoginPage} onOpenLandlordSignup={openLandlordSignupPage} />
  return <LandlordPaybillContext.Provider value={landlordPaymentDetails}><TenantDirectoryContext.Provider value={tenantList}><ConfirmedRentPaymentRefreshContext.Provider value={{ refresh: refreshConfirmedRentPayments, refreshing: rentPaymentsRefreshing, error: rentPaymentsRefreshError }}><ConfirmedRentPaymentsContext.Provider value={directRentPayments}><div className={`app-shell ${darkMode ? 'dark' : ''}`}>
    {/* Subscription Warning Banner (7 days before expiry) */}
    {subStatus.isExpiring && (
      <div className="subscription-warning-banner">
        <div className="swb-content">
          <span className="swb-icon">⏰</span>
          <div>
            <strong>Subscription expiring soon</strong>
            <span>{subStatus.daysLeft} day{subStatus.daysLeft !== 1 ? 's' : ''} remaining</span>
          </div>
          <button className="swb-button" onClick={() => void openSubscriptionModal()}>
            Renew Now
          </button>
        </div>
      </div>
    )}
    
    {/* Mobile overlay */}
    {sidebarOpen && <button className="sidebar-overlay" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><MohaLogo size={20} /></span><span>{workspaceName}</span></div>
      <div className="workspace-switcher"><span className="workspace-dot"><MohaLogo size={18} /></span><span><strong>{workspaceName}</strong><small>{propertyGroup}</small></span><ChevronDown size={15} /></div>
      <nav aria-label="Main navigation"><p className="nav-label">Workspace</p>{navItems.map(({ label, icon: Icon, count }) => <button key={label} className={`nav-item ${activeSection === label ? 'active' : ''}`} onClick={() => { navigate(label); setSidebarOpen(false) }}><Icon size={18} /><span>{label}</span>{count && <em>{count}</em>}</button>)}<p className="nav-label nav-label-spaced">Manage</p>{can.viewSettings && <button className={`nav-item ${activeSection === 'Settings' ? 'active' : ''}`} onClick={() => { navigate('Settings'); setSidebarOpen(false) }}><Settings size={18} /><span>Settings</span></button>}<button className={`nav-item ${activeSection === 'Help center' ? 'active' : ''}`} onClick={() => { navigate('Help center'); setSidebarOpen(false) }}><LifeBuoy size={18} /><span>Help center</span></button></nav>
      <div className="sidebar-footer"><div className="avatar">{initials}</div><div><strong>{sessionUser.name}</strong><small>{sessionUser.role} · {sessionUser.userType}</small></div><button className="logout-button" aria-label="Log out" onClick={signOut}><LogOut size={15} /></button></div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <button className="mobile-menu" aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
        <div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{activeSection}</strong></div>
        <div className="top-actions">
          <button className="icon-button" aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setDarkMode(!darkMode)}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button
            className="profile-trigger"
            aria-label="Open profile menu"
            onClick={() => { setShowProfile(!showProfile); setShowNotice(false) }}
          >
            <span className="top-avatar">{initials}</span>
            <span className="profile-trigger-name">{sessionUser.name.split(' ')[0]}</span>
            <ChevronDown size={14} className={showProfile ? 'profile-chevron open' : 'profile-chevron'} />
          </button>
        </div>
        {showNotice && (
          <div className="notification-popover">
            {rentReminderQueue.length > 0 ? (
              <>
                <strong>{rentReminderQueue.length} rent reminder{rentReminderQueue.length === 1 ? '' : 's'} pending</strong>
                <div className="mini-ledger">
                  {rentReminderQueue.slice(0, 3).map(({ id, tenant, status }) => (
                    <div key={id}>
                      <span>
                        <strong>{tenant.name}</strong>
                        <small>{tenant.property} · {getTenantUnitLabel(tenant)} · {status}</small>
                      </span>
                      <button type="button" className="reminder-button" onClick={() => sendRentReminder(tenant)}>{rentReminderChannel}</button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <strong>You are all caught up</strong>
                <span>No new notifications right now.</span>
              </>
            )}
          </div>
        )}
        {showProfile && (
          <div className="profile-dropdown" role="menu">
            {/* Header */}
            <div className="profile-dropdown-header">
              <span className="profile-dropdown-avatar">{initials}</span>
              <div className="profile-dropdown-info">
                <strong>{sessionUser.name}</strong>
                <small>@{sessionUser.username}</small>
                <span className={`role-badge role-${sessionUser.role.toLowerCase()}`}>{sessionUser.role}</span>
              </div>
              <span className="profile-online-dot" title="Active now" />
            </div>
            <div className="profile-dropdown-meta">
              <span>🏢 {propertyGroup}</span>
              <span>🕐 Signed in at {loginTime.current}</span>
            </div>
            {/* Links */}
            <div className="profile-dropdown-section">
              <button className="profile-dropdown-item" onClick={() => { navigate('Settings'); setShowProfile(false) }}>
                <span className="pdi-icon pdi-profile">👤</span>
                <span><strong>My Profile</strong><small>View and edit your account</small></span>
              </button>
              <button className="profile-dropdown-item" onClick={() => { setShowResetSelf(true); setShowProfile(false); setSelfPasswordMsg('') }}>
                <span className="pdi-icon pdi-key">🔑</span>
                <span><strong>Change Password</strong><small>Update your login password</small></span>
              </button>
              <button className="profile-dropdown-item" onClick={() => { navigate('Settings'); setShowProfile(false) }}>
                <span className="pdi-icon pdi-settings">⚙️</span>
                <span><strong>Settings</strong><small>Workspace & notifications</small></span>
              </button>
              <button className="profile-dropdown-item" onClick={() => { setDarkMode(!darkMode); setShowProfile(false) }}>
                <span className="pdi-icon pdi-theme">{darkMode ? '☀️' : '🌙'}</span>
                <span><strong>{darkMode ? 'Light Mode' : 'Dark Mode'}</strong><small>{darkMode ? 'Switch to light theme' : 'Switch to dark theme'}</small></span>
              </button>
              <button className="profile-dropdown-item" onClick={() => { navigate('Help center'); setShowProfile(false) }}>
                <span className="pdi-icon pdi-help">❓</span>
                <span><strong>Help Center</strong><small>Guides and quick answers</small></span>
              </button>
            </div>
            {/* Subscription status */}
            <div className="profile-dropdown-section subscription-status">
              <div className="sub-status-header">
                <span>💳 Subscription</span>
                {sessionUser.subscriptionRequest?.status === 'pending' ? (
                  <span className="sub-badge pending">Pending</span>
                ) : sessionUser.subscription ? (
                  <span className={`sub-badge ${subStatus.isValid ? sessionUser.subscription.status === 'trial' ? 'trial' : 'active' : 'expired'}`}>
                    {subStatus.isValid ? sessionUser.subscription.status === 'trial' ? 'Trial' : 'Active' : 'Expired'}
                  </span>
                ) : (
                  <span className="sub-badge trial">No plan</span>
                )}
              </div>
              {sessionUser.subscriptionRequest?.status === 'pending' ? (
                <div className="sub-details">
                  <small>Payment awaiting admin verification</small>
                  <small>KSh {sessionUser.subscriptionRequest.amount.toLocaleString()} · Reference {sessionUser.subscriptionRequest.mpesaCode}</small>
                </div>
              ) : sessionUser.subscription && (
                <div className="sub-details">
                  <small>
                    {sessionUser.subscription.plan === 'test' ? 'Test plan · Free for 1 month' : sessionUser.subscription.plan === 'silver_monthly' ? 'Silver · KSh 500/mo' : sessionUser.subscription.plan === 'silver_yearly' ? 'Silver · KSh 4,500/yr' : sessionUser.subscription.plan === 'monthly' ? 'Legacy monthly plan' : 'Legacy yearly plan'}
                  </small>
                  <small>{subStatus.isValid ? `${subStatus.daysLeft} days remaining` : 'Please renew'}</small>
                </div>
              )}
              <button className="sub-manage-btn" disabled={sessionUser.subscriptionRequest?.status === 'pending'} onClick={() => void openSubscriptionModal()}>
                {sessionUser.subscriptionRequest?.status === 'pending' ? 'Payment pending review' : sessionUser.subscription ? 'Renew Subscription' : 'Subscribe Now'}
              </button>
            </div>
            {/* Footer — sign out */}
            <div className="profile-dropdown-footer">
              <button className="profile-signout-btn" onClick={() => { signOut(); setShowProfile(false) }}>
                <LogOut size={15} /> Sign out
              </button>
            </div>
          </div>
        )}
      </header>
      <div className="content-wrap">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">{isPlatformAdministrator ? 'PLATFORM PORTFOLIO' : today}</p>
            <h1>{isPlatformAdministrator ? 'Portfolio overview' : <>Welcome back, {sessionUser.name} <span>✦</span></>}</h1>
            <p className="subhead">{isPlatformAdministrator ? 'Review property performance across every landlord workspace.' : <>Signed in as <strong>{sessionUser.username}</strong> · {sessionUser.role} &nbsp;|&nbsp; {propertyGroup}</>}</p>
          </div>
          <div className="welcome-row-actions">
            {!isPlatformAdministrator && can.addProperty && <button className="primary-button" onClick={() => setModalType('property')}><Plus size={17} /> Add property</button>}
            {!isPlatformAdministrator && can.addTenant && <button className="filter-button" onClick={() => setModalType('tenant')}><Users size={16} /> Add tenant</button>}
          </div>
        </section>
        {activeSection === 'Overview' ? isPlatformAdministrator ? <PlatformAdminPortfolioDashboard workspaces={platformLandlordWorkspaces} landlordAccountCount={users.filter(account => account.userType === 'Landlord').length} loading={platformPortfolioLoading} error={platformPortfolioError} onRefresh={() => void refreshPlatformPortfolio()} /> : <>
        <section className="metric-grid" aria-label="Portfolio summary">
          <article className="metric-card featured"><div className="metric-top"><span className="metric-icon"><Building2 size={18} /></span><span className="trend positive">Live</span></div><p>Monthly rent roll</p><strong>KSh {monthlyRentRoll.toLocaleString()}</strong><small>Across {totalUnits} listed units</small></article>
          <article className="metric-card"><div className="metric-top"><span className="metric-icon mint"><CircleDollarSign size={18} /></span><span className="trend positive">Live</span></div><p>Recorded payments</p><strong>KSh {collectedPayments.toLocaleString()}</strong><small>{(savedRows.Payments ?? []).length} payment records</small></article>
          <article className="metric-card"><div className="metric-top"><span className="metric-icon peach"><Users size={18} /></span><span className="trend positive">Live</span></div><p>Occupancy rate</p><strong>{totalUnits ? `${Math.round(occupiedUnits / totalUnits * 100)}%` : '0%'}</strong><small>{occupiedUnits} of {totalUnits} units occupied</small></article>
          <article className="metric-card"><div className="metric-top"><span className="metric-icon lavender"><Wrench size={18} /></span><span className="trend neutral">Live</span></div><p>Open maintenance</p><strong>{openMaintenance.toString().padStart(2, '0')}</strong><small>{(savedRows.Maintenance ?? []).length - openMaintenance} completed</small></article>
        </section>
        <section className="dashboard-grid"><article className="panel revenue-panel"><div className="panel-heading"><div><p className="eyebrow">Live performance</p><h2>Revenue overview</h2></div><span className="live-badge">Updated from records</span></div><div className="revenue-summary"><strong>KSh {collectedPayments.toLocaleString()}</strong><span className="trend positive">Live</span><small>Total recorded payments</small></div><div className="live-revenue-list">{visibleRevenueRows.map((row) => { const [amount, tenant = '', date = ''] = row.split(' · '); return <div key={row}><span><strong>{amount}</strong><small>{tenant}</small></span><time>{date}</time></div> })}{(savedRows.Payments ?? []).length === 0 && <p className="overview-empty">Payment records will appear here after you add them.</p>}</div>{revenueRows.length > overviewPageSize && <Pagination page={Math.min(overviewRevenuePage, revenuePageCount)} pageCount={revenuePageCount} onPageChange={setOverviewRevenuePage} />}</article>
          <article className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">Live feed</p><h2>Recent activity</h2></div><span className="live-badge">Live</span></div><div className="activity-list">{visibleActivities.map(({ icon: Icon, title, detail, time, tone }, index) => <div className="activity-item" key={`${title}-${detail}-${index}`}><span className={`activity-icon ${tone}`}><Icon size={17} /></span><div><strong>{title}</strong><small>{detail}</small></div><time>{time}</time></div>)}{overviewActivities.length === 0 && <p className="overview-empty">Activity will appear here as you add records.</p>}</div>{overviewActivities.length > overviewPageSize && <Pagination page={Math.min(overviewActivityPage, activityPageCount)} pageCount={activityPageCount} onPageChange={setOverviewActivityPage} />}</article></section>
        <section className="portfolio-health panel" aria-label="Portfolio health"><div className="panel-heading"><div><p className="eyebrow">Operational snapshot</p><h2>Portfolio health</h2></div><span className="live-badge">Current month</span></div><div className="health-grid"><article><span className="health-icon collection"><CircleDollarSign size={18} /></span><div><strong>{collectionRate}% collected</strong><small>KSh {Math.max(monthlyRentRoll - collectedPayments, 0).toLocaleString()} outstanding this month</small></div></article><article><span className="health-icon vacancy"><Home size={18} /></span><div><strong>{vacantUnits} vacant {vacantUnits === 1 ? 'unit' : 'units'}</strong><small>{occupiedUnits} active residents across the portfolio</small></div></article><article><span className="health-icon lease"><CalendarDays size={18} /></span><div><strong>{upcomingLeases.length} lease{upcomingLeases.length === 1 ? '' : 's'} due soon</strong><small>{upcomingLeases.length ? `${upcomingLeases[0].name} ends ${new Date(`${upcomingLeases[0].leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { month: 'short', day: 'numeric' })}` : 'No lease renewals due in the next 60 days'}</small></div></article></div></section>
        <section className="panel" aria-label="Auto rent reminders"><div className="panel-heading"><div><p className="eyebrow">Collections</p><h2>Auto rent reminders</h2></div><span className="live-badge">{rentReminderQueue.length} pending</span></div>{rentReminderQueue.length ? <div className="due-list">{visibleReminders.map(({ id, tenant, status, dueLabel }) => <div key={id}><span><strong>{tenant.name}</strong><small>{tenant.property} · {getTenantUnitLabel(tenant)} · {dueLabel}</small></span><span className={`payment-state ${status === 'Overdue' ? 'due' : 'paid'}`}>{status}</span><button type="button" className="reminder-button" onClick={() => sendRentReminder(tenant)}>{rentReminderChannel}</button></div>)}</div> : <p className="overview-empty" style={{ padding: '18px 0 10px' }}>All tenants are up to date. No rent reminders are queued right now.</p>}{rentReminderQueue.length > overviewPageSize && <Pagination page={Math.min(overviewReminderPage, reminderPageCount)} pageCount={reminderPageCount} onPageChange={setOverviewReminderPage} />}</section>
        <section className="panel properties-panel"><div className="panel-heading"><div><p className="eyebrow">Your portfolio</p><h2>Properties</h2></div><div className="panel-actions"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setOverviewPropertyPage(1) }} placeholder="Search properties" /></label><button className="filter-button"><ClipboardList size={16} /> Filters</button></div></div><div className="table-wrap"><table><thead><tr><th>Property</th><th>Occupancy</th><th>Monthly income</th><th>Status</th><th></th></tr></thead><tbody>{visibleOverviewProperties.map((property) => <tr key={property.name}><td><span className={`property-thumb ${property.color}`}><Building2 size={18} /></span><span><strong>{property.name}</strong><small>{property.address}</small></span></td><td><div className="occupancy"><span>{property.occupied} / {property.units} units</span><div><i style={{ width: `${property.units ? property.occupied / property.units * 100 : 0}%` }}></i></div></div></td><td><strong>{property.income}</strong><small>per month</small></td><td><span className={`status ${property.status.toLowerCase()}`}>{property.status}</span></td><td><button className="row-arrow" aria-label={`Open ${property.name}`} onClick={() => { setActiveSection('Properties'); setSelectedProperty(property.name) }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>{filteredProperties.length > propertyPageSize && <Pagination page={Math.min(overviewPropertyPage, propertyPageCount)} pageCount={propertyPageCount} onPageChange={setOverviewPropertyPage} />}</section>
        {pendingWaterBillInvoices.length > 0 && <section className="panel water-bill-pending-panel" role="status">
          <div className="panel-heading"><div><p className="eyebrow">Invoice waiting</p><h2>Water bill needed</h2><p>These rents are due, but the current-cycle water bill has not been updated. Update the bill to release the tenant invoice.</p></div><span className="live-badge">{pendingWaterBillInvoices.length} pending</span></div>
          <div className="due-list">{pendingWaterBillInvoices.map(({ id, tenant, dueLabel }) => <div key={id}><span><strong>{tenant.name}</strong><small>{tenant.property} · Unit {getTenantUnitLabel(tenant)} · Rent due {dueLabel}</small></span><button type="button" className="reminder-button" onClick={() => { setSelectedTenant(tenant); setModalType('waterBill') }}>Update bill</button></div>)}</div>
        </section>}
        <footer className="app-footer">
          <div className="app-footer-inner">
            {/* Brand column */}
            <div className="footer-brand">
              <div className="footer-logo"><MohaLogo size={18} /></div>
              <div>
                <strong>{workspaceName}</strong>
                <p>A complete rental property management system for landlords, caretakers, and property managers in Kenya.</p>
              </div>
            </div>

            {/* Quick links */}
            <div className="footer-col">
              <h4>Quick links</h4>
              <ul>
                {['Overview','Properties','Tenants','Maintenance','Payments','Operations','Documents'].map(s => (
                  <li key={s}><button onClick={() => navigate(s)}>{s}</button></li>
                ))}
              </ul>
            </div>

            {/* Manage */}
            <div className="footer-col">
              <h4>Manage</h4>
              <ul>
                <li><button onClick={() => navigate('Settings')}>Settings</button></li>
                <li><button onClick={() => navigate('Help center')}>Help center</button></li>
                <li><button onClick={() => { setShowResetSelf(true); setSelfPasswordMsg('') }}>Change password</button></li>
                <li><button onClick={signOut}>Sign out</button></li>
              </ul>
            </div>

            {/* About */}
            <div className="footer-col footer-about">
              <h4>About</h4>
              <p>Built for Kenyan property managers. Manage units, collect rent, track maintenance, and generate invoices — all in one place.</p>
              <div className="footer-badges">
                <span>🏠 Properties</span>
                <span>👥 Tenants</span>
                <span>💰 Payments</span>
                <span>🔧 Maintenance</span>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="app-footer-bottom">
            <span>© {new Date().getFullYear()} {workspaceName}. All rights reserved.</span>
            <span className="footer-status">
              <span className="footer-dot" />
              {cloudStatus}
            </span>
            <span><CalendarDays size={13} /> {today}</span>
          </div>
        </footer>
        </> : null}
        {activeSection === 'Properties' && selectedProperty ? <PropertyUnitsView
            propertyName={selectedProperty}
            property={propertyList.find(p => p.name === selectedProperty)!}
            units={unitDetails[selectedProperty] ?? []}
            tenants={tenantList.filter(t => t.property === selectedProperty)}
            payments={(savedRows.Payments ?? []).filter(r => r.includes(selectedProperty))}
            maintenance={(savedRows.Maintenance ?? []).filter(r => r.includes(selectedProperty))}
            completedMaintenance={completedMaintenance}
            onBack={() => setSelectedProperty(null)}
            onRenameUnit={(unitId, displayName) => {
              setUnitDetails(current => ({
                ...current,
                [selectedProperty]: (current[selectedProperty] ?? []).map(unit => unit.unit === unitId ? { ...unit, displayName } : unit),
              }))
              setTenantList(current => current.map(tenant => tenant.property === selectedProperty && tenant.unit === unitId ? { ...tenant, unitDisplayName: displayName } : tenant))
            }}
          /> : activeSection === 'Tenant portal' ? <TenantPortalView
              tenants={tenantList}
              workspaceName={workspaceName}
              propertyGroup={propertyGroup}
              paymentRows={savedRows.Payments ?? []}
              directRentPayments={directRentPayments}
            /> : activeSection === 'Settings' ? (can.viewSettings ? <SettingsView
              sessionUser={sessionUser}
              users={users}
              workspaceName={workspaceName}
              propertyGroup={propertyGroup}
              landlordPaybill={landlordPaybill}
              landlordPaymentMethod={landlordPaymentMethod}
              landlordTillNumber={landlordTillNumber}
              landlordBankName={landlordBankName}
              landlordBankAccountName={landlordBankAccountName}
              landlordBankAccountNumber={landlordBankAccountNumber}
              notifEmail={notifEmail}
              notifWeekly={notifWeekly}
              rentReminderEnabled={rentReminderEnabled}
              rentReminderDays={rentReminderDays}
              rentReminderChannel={rentReminderChannel}
              onReviewSubscriptionPayment={reviewCloudSubscriptionPayment}
              onLoadSubscriptionPaymentHistory={loadCloudSubscriptionPaymentHistory}
              onApproveLandlordSignup={async (userId) => {
                if (!supabase) throw new Error('Supabase is not configured.')
                const { data, error } = await supabase.rpc('approve_public_landlord_signup', { p_user_id: userId })
                if (error) throw new Error(error.message)
                const result = data as { requested_plan?: PublicLandlordPlan; subscription?: { plan: string; status: string; starts_on: string; expires_on: string; amount: number } | null }
                setUsers(current => current.map(user => {
                  if (user.id !== userId) return user
                  const updated: AccessUser = { ...user, signupStatus: 'approved', active: true, requestedPlan: result.requested_plan ?? user.requestedPlan }
                  if (result.subscription) updated.subscription = { plan: 'test', status: 'trial', startDate: result.subscription.starts_on, expiryDate: result.subscription.expires_on, amount: result.subscription.amount }
                  return updated
                }))
                await refreshPlatformPortfolio()
              }}
              onRejectLandlordSignup={async (userId) => {
                if (!supabase) throw new Error('Supabase is not configured.')
                const { error } = await supabase.rpc('reject_public_landlord_signup', { p_user_id: userId })
                if (error) throw new Error(error.message)
                setUsers(current => current.map(user => user.id === userId ? { ...user, signupStatus: 'rejected' } : user))
              }}
              onRegisterRentPaybillCallbacks={registerRentPaybillCallbacks}
              onSaveWorkspace={handleSaveWorkspace}
              onSaveSubscriptionPaymentDetails={setSubscriptionPaymentDetails}
              onToggleNotifEmail={() => setNotifEmail(v => !v)}
              onToggleNotifWeekly={() => setNotifWeekly(v => !v)}
              onToggleRentReminder={() => setRentReminderEnabled(v => !v)}
              onChangeRentReminderDays={(value) => setRentReminderDays(value)}
              onChangeRentReminderChannel={(value) => setRentReminderChannel(value)}
              onCreateUser={async (user) => {
                if (!supabase || !user.email) throw new Error('A Supabase Auth email is required.')
                const { data, error } = await supabase.functions.invoke('admin-manage-user', {
                  body: { action: 'invite', email: user.email, name: user.name, phone: user.phone, role: toDatabaseRole(user.role), userType: toDatabaseUserType(user.userType), redirectTo: window.location.origin },
                })
                if (error) {
                  const context = 'context' in error ? error.context : undefined
                  if (context instanceof Response) {
                    const responseText = await context.clone().text()
                    let detail = responseText
                    try {
                      const responseBody = JSON.parse(responseText) as { error?: unknown; message?: unknown }
                      if (typeof responseBody.error === 'string') detail = responseBody.error
                      else if (typeof responseBody.message === 'string') detail = responseBody.message
                    } catch {
                      detail = responseText || error.message
                    }
                    throw new Error(detail || `${error.message} (HTTP ${context.status})`)
                  }
                  throw new Error(error.message)
                }
                if (!data?.userId) throw new Error('Supabase did not return the invited account ID.')
                setUsers(current => [...current, { ...user, id: data.userId, username: user.email ?? '' }])
              }}
              onUpdateUser={async (updatedUser, originalUser) => {
                if (!supabase) throw new Error('Supabase is not configured.')
                if (updatedUser.email !== originalUser.email) {
                  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
                  if (sessionError) throw new Error(`Could not verify your sign-in: ${sessionError.message}`)
                  if (!session) throw new Error('Your sign-in session has expired. Sign out and sign in again.')
                  const { error } = await supabase.functions.invoke('admin-manage-user', {
                    body: { action: 'update-email', userId: updatedUser.id, email: updatedUser.email },
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  })
                  if (error) {
                    const context = 'context' in error ? error.context : undefined
                    if (context instanceof Response) {
                      const responseText = await context.clone().text()
                      let detail = responseText
                      try {
                        const responseBody = JSON.parse(responseText) as { error?: unknown; message?: unknown }
                        if (typeof responseBody.error === 'string') detail = responseBody.error
                        else if (typeof responseBody.message === 'string') detail = responseBody.message
                      } catch {
                        detail = responseText || error.message
                      }
                      throw new Error(detail || `${error.message} (HTTP ${context.status})`)
                    }
                    throw new Error(error.message)
                  }
                }
                await persistCloudUserAccess(updatedUser)
              }}
              onDeleteUser={async (id) => {
                if (!supabase) throw new Error('Supabase is not configured.')
                const { data: { session }, error: sessionError } = await supabase.auth.getSession()
                if (sessionError) throw new Error(`Could not verify your sign-in: ${sessionError.message}`)
                if (!session) throw new Error('Your sign-in session has expired. Sign out and sign in again.')
                const { error } = await supabase.functions.invoke('admin-manage-user', {
                  body: { action: 'delete', userId: id },
                  headers: { Authorization: `Bearer ${session.access_token}` },
                })
                if (error) {
                  const context = 'context' in error ? error.context : undefined
                  if (context instanceof Response) {
                    const responseText = await context.clone().text()
                    let detail = responseText
                    try {
                      const responseBody = JSON.parse(responseText) as { error?: unknown; message?: unknown }
                      if (typeof responseBody.error === 'string') detail = responseBody.error
                      else if (typeof responseBody.message === 'string') detail = responseBody.message
                    } catch {
                      detail = responseText || error.message
                    }
                    throw new Error(detail || `${error.message} (HTTP ${context.status})`)
                  }
                  throw new Error(error.message)
                }
                setUsers(current => current.filter(user => user.id !== id))
              }}
              onDisconnect={async (id) => { const user = users.find(item => item.id === id); if (user) await persistCloudUserAccess({ ...user, active: false }) }}
              onReconnect={async (id) => { const user = users.find(item => item.id === id); if (user) await persistCloudUserAccess({ ...user, active: true }) }}
              onResetPassword={async (email) => {
                if (!supabase) throw new Error('Supabase is not configured.')
                const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
                if (error) throw new Error(error.message)
                setCloudStatus(`Password reset email sent to ${email}`)
              }}
            /> : <AccessDeniedView section="Settings" />) : activeSection === 'Help center' ? <HelpCenterView /> : activeSection === 'Documents' ? <DocumentsView invoices={invoiceList} legacyRows={savedRows.Documents ?? sectionDetails.Documents.rows} canAdd={can.addDocument} onAdd={() => setModalType('document')} onReopenInvoice={(invoice) => { const tenant = tenantList.find(t => t.unit === invoice.unit && t.property === invoice.property); if (tenant) { setInvoiceTenant(tenant); setActiveInvoice(invoice) } }} /> : activeSection === 'Operations' ? <OperationsCenter tenants={tenantList} properties={propertyList} payments={savedRows.Payments ?? []} expenses={expenses} applicants={applicants} workspaceName={workspaceName} onAddExpense={(expense) => setExpenses((current) => [expense, ...current])} onAddApplicant={(applicant) => setApplicants((current) => [applicant, ...current])} onGenerateInvoice={generateInvoice} onEditExpense={(expense) => setEditingExpense(expense)} onDeleteExpense={(id) => { if (window.confirm('Delete this expense?')) setExpenses(c => c.filter(e => e.id !== id)) }} onToggleExpensePaid={(id) => setExpenses(current => current.map(expense => expense.id === id ? { ...expense, paid: !expense.paid } : expense))} onApplicantAction={(id, action) => { if (action === 'approve') setApplicants(c => c.map(a => a.id === id ? { ...a, stage: 'Approved' } : a)); else if (action === 'reject') { if (window.confirm('Remove this applicant?')) setApplicants(c => c.filter(a => a.id !== id)) } else if (action === 'schedule') setApplicants(c => c.map(a => a.id === id ? { ...a, stage: 'Applied' } : a)); else if (action === 'convert') { const app = applicants.find(a => a.id === id); if (app) { setEditingApplicant(app); setModalType('tenant') } } }} /> : activeSection !== 'Overview'             ? <SectionView section={activeSection} rows={activeSection === 'Properties' ? propertyList.map((property) => `${property.name} · ${property.units} units · ${property.occupied} occupied`) : activeSection === 'Tenants' ? tenantList.map((tenant) => `${tenant.name} · Unit ${tenant.unit} · ${tenant.unitType} · KSh ${tenant.rent} · ${tenant.property} · ${tenant.waterBill ?? '0'}`) : activeSection === 'Payments' ? savedRows.Payments ?? [] : savedRows[activeSection] ?? sectionDetails[activeSection].rows} completedMaintenance={completedMaintenance} showConfirmedRentPayments={Boolean(effectiveRentPaybill)} onRowClick={activeSection === 'Properties' ? (index) => setSelectedProperty(propertyList[index].name) : undefined} onWaterBillUpdate={activeSection === 'Tenants' && can.addTenant ? (index) => { setSelectedTenant(tenantList[index]); setModalType('waterBill') } : undefined} onGenerateInvoice={activeSection === 'Tenants' ? (index) => generateInvoice(tenantList[index]) : undefined} onRemoveTenant={activeSection === 'Tenants' && can.removeTenantAccess ? (index) => removeTenant(tenantList[index]) : undefined} onOpenMaintenance={activeSection === 'Maintenance' ? (index) => setSelectedMaintenance((savedRows.Maintenance ?? sectionDetails.Maintenance.rows)[index]) : undefined} onEditProperty={activeSection === 'Properties' && can.addProperty ? (index) => setEditingProperty(propertyList[index]) : undefined} onDeleteProperty={activeSection === 'Properties' && can.addProperty ? (index) => deleteProperty(propertyList[index].name) : undefined} onViewTenantProfile={activeSection === 'Tenants' ? (index) => setViewingTenant(tenantList[index]) : undefined} onEditTenant={activeSection === 'Tenants' && can.addTenant ? (index) => setEditingTenant(tenantList[index]) : undefined} onEditPayment={activeSection === 'Payments' && can.addPayment ? (index) => setEditingPaymentIdx(index) : undefined} onDeletePayment={activeSection === 'Payments' && can.addPayment ? (index) => deletePayment(index) : undefined} onEditMaintenance={activeSection === 'Maintenance' && can.addMaintenance ? (index) => setEditingMaintenanceIdx(index) : undefined}             onDeleteMaintenance={activeSection === 'Maintenance' && can.addMaintenance ? (index) => deleteMaintenance(index) : undefined} onMarkMaintenanceDone={activeSection === 'Maintenance' && can.addMaintenance ? (index) => markMaintenanceDone(index) : undefined} onAdd={activeSection === 'Properties' && can.addProperty ? () => setModalType('property') : activeSection === 'Tenants' && can.addTenant ? () => setModalType('tenant') : activeSection === 'Maintenance' && can.addMaintenance ? () => setModalType('maintenance') : activeSection === 'Payments' && can.addPayment ? () => setModalType('payment') : null} /> : null}
        {canAccessSystem && modalType && <AddModal type={modalType} properties={propertyList} unitDetails={unitDetails} initialValues={modalType === 'waterBill' && selectedTenant ? { amount: selectedTenant.waterBill ?? '' } : modalType === 'tenant' && editingApplicant ? { name: editingApplicant.name, phone: editingApplicant.phone, property: editingApplicant.property, unit: editingApplicant.unit } : undefined} onClose={() => { setModalType(null); setEditingApplicant(null) }} onSave={(values, sendPortalWhatsApp, unitMix) => {
          if (modalType === 'property') {
            const mix = unitMix.map((item) => ({ type: item.type.trim(), count: Number(item.count), rent: Number(item.rent) }))
            const units = mix.reduce((total, item) => total + item.count, 0)
            const income = mix.reduce((total, item) => total + item.count * item.rent, 0)
            const records = mix.flatMap((item) => Array.from({ length: item.count }, (_, index) => ({ unit: `${item.type}-${index + 1}`, type: item.type, tenant: 'Vacant', status: 'Vacant', rent: `KSh ${item.rent.toLocaleString()}` })))
            setPropertyList((current) => [...current, { name: values.name, address: values.address, units, occupied: 0, income: `KSh ${income.toLocaleString()}`, status: 'Attention', color: 'blue' }])
            setUnitDetails((current) => ({ ...current, [values.name]: records }))
          } else if (modalType === 'tenant') {
            const selectedUnit = (unitDetails[values.property] ?? []).find((unit) => unit.unit === values.unit && unit.status === 'Vacant')
            if (selectedUnit) {
              const movedIn = values.assignedDate || localDateString()
              const leaseEnd = values.leaseEnd || oneYearAfter(movedIn)
              const newTenant: TenantRecord = { name: values.name, email: values.email, phone: values.phone, idNumber: values.idNumber, unit: selectedUnit.unit, unitDisplayName: selectedUnit.displayName || selectedUnit.unit, unitType: selectedUnit.type, property: values.property, rent: selectedUnit.rent.replace('KSh ', ''), lease: `Ends ${new Date(`${leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })}`, leaseEnd, movedIn, rentAccountRef: makeRentAccountReference(), portalCode: values.portalCode, status: 'Active', waterBill: '0' }
              setTenantList((current) => [...current, newTenant])
              setUnitDetails((current) => ({ ...current, [values.property]: (current[values.property] ?? []).map((unit) => unit.unit === selectedUnit.unit ? { ...unit, tenant: values.name, status: 'Occupied' } : unit) }))
              setPropertyList((current) => current.map((property) => property.name === values.property ? { ...property, occupied: Math.min(property.occupied + 1, property.units), status: 'Healthy' } : property))
              if (sendPortalWhatsApp && newTenant.email && newTenant.phone && newTenant.portalCode) {
                const phone = normalizeKenyanPhone(newTenant.phone)
                const message = [
                  `Dear ${newTenant.name},`,
                  '',
                  `Welcome to ${workspaceName}. Your tenant portal access is ready.`,
                  `Portal: ${window.location.origin}/tenant`,
                  `Email: ${newTenant.email}`,
                  `Portal passcode: ${newTenant.portalCode}`,
                  `Property: ${newTenant.property}`,
                  `Unit: ${newTenant.unit}`,
                  '',
                  'Please keep your portal passcode private.',
                ].join('\n')
                window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')
              }
            }
          } else if (modalType === 'waterBill' && selectedTenant) {
            setTenantList((current) => current.map((tenant) => tenant.name === selectedTenant.name && tenant.unit === selectedTenant.unit && tenant.property === selectedTenant.property ? { ...tenant, waterBill: values.amount, waterBillUpdatedAt: new Date().toISOString() } : tenant))
            setSelectedTenant(null)
          } else {
            const section = modalType === 'maintenance' ? 'Maintenance' : modalType === 'payment' ? 'Payments' : 'Documents'
            const maintenanceUnit = modalType === 'maintenance' ? (unitDetails[values.property] ?? []).find((unit) => unit.unit === values.houseNumber) : undefined
            const paymentUnit = modalType === 'payment' ? (unitDetails[values.property] ?? []).find((unit) => unit.unit === values.houseNumber) : undefined
            const paymentAmount = paymentUnit?.rent.replace(/[^0-9.]/g, '') ?? values.amount
            const summary = modalType === 'maintenance' ? `${values.maintenanceType} · ${values.issue} · ${maintenanceUnit?.tenant ?? 'Vacant'} · House ${values.houseNumber} · ${values.property} · ${values.priority} priority` : modalType === 'payment' ? `KSh ${Number(paymentAmount).toLocaleString()} · ${paymentUnit?.tenant ?? 'Vacant'} · House ${values.houseNumber} · ${values.property} · ${values.date} · ${values.paymentMethod || 'Payment'} · ${values.reference || 'No reference'} · ${values.period || 'Period not set'}` : modalType === 'document' ? `${values.name} · ${values.property} · ${values.date}` : `${values.name} · Unit ${values.unit} · ${values.property}`
            setSavedRows((current) => ({ ...current, [section]: [...(current[section] ?? sectionDetails[section].rows), summary] }))
          }
          setModalType(null)
          setEditingApplicant(null)
        }} />}
        {canAccessSystem && invoiceTenant && activeInvoice && <InvoiceModal tenant={invoiceTenant} invoice={activeInvoice} workspaceName={workspaceName} paymentDetails={landlordPaymentDetails} onEmailChange={(email) => { setInvoiceTenant((current) => current ? { ...current, email } : current); setTenantList((current) => current.map((tenant) => tenant.name === invoiceTenant.name && tenant.unit === invoiceTenant.unit && tenant.property === invoiceTenant.property ? { ...tenant, email } : tenant)) }} onClose={() => { setInvoiceTenant(null); setActiveInvoice(null) }} />}
        {canAccessSystem && selectedMaintenance && <MaintenanceDetailsModal row={selectedMaintenance} isDone={Boolean(completedMaintenance[selectedMaintenance])} onMarkDone={() => setCompletedMaintenance((current) => ({ ...current, [selectedMaintenance]: true }))} onClose={() => setSelectedMaintenance(null)} />}
        {canAccessSystem && showResetSelf && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowResetSelf(false) }}>
            <form className="add-modal" onSubmit={async e => {
              e.preventDefault()
              if (!selfNewPassword.trim()) return
              if (!supabase) return
              const { error } = await supabase.auth.updateUser({ password: selfNewPassword.trim() })
              if (error) { setSelfPasswordMsg(error.message); return }
              setSelfPasswordMsg('Password updated successfully!')
              setSelfNewPassword('')
              setTimeout(() => { setShowResetSelf(false); setSelfPasswordMsg('') }, 1500)
            }}>
              <button type="button" className="modal-close" onClick={() => setShowResetSelf(false)}>×</button>
              <p className="eyebrow">Security</p>
              <h2>Change Password</h2>
              <p className="modal-description">Set a new password for your account <strong>@{sessionUser.username}</strong>.</p>
              <label className="form-field"><span>New password</span><input required type="password" placeholder="Enter new password" value={selfNewPassword} onChange={e => setSelfNewPassword(e.target.value)} /></label>
              {selfPasswordMsg && <p className="settings-saved-msg">{selfPasswordMsg}</p>}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setShowResetSelf(false)}>Cancel</button>
                <button type="submit" className="primary-button">Update password</button>
              </div>
            </form>
          </div>
        )}
        {/* Tenant Profile Modal */}
        {canAccessSystem && viewingTenant && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setViewingTenant(null) }}>
            <div className="tenant-profile-modal">
              <button type="button" className="modal-close" onClick={() => setViewingTenant(null)}>×</button>
              <div className="tpm-header">
                <span className="tpm-avatar">{viewingTenant.name.slice(0, 2).toUpperCase()}</span>
                <div><h2>{viewingTenant.name}</h2><p>{viewingTenant.property} · Unit {getTenantUnitLabel(viewingTenant)}</p></div>
                <button className="tpm-edit-btn" onClick={() => { setEditingTenant(viewingTenant); setViewingTenant(null) }}>✏️ Edit</button>
              </div>
              <div className="tpm-grid">
                <div><span>Unit</span><strong>{getTenantUnitLabel(viewingTenant)}</strong></div>
                <div><span>Unit Type</span><strong>{viewingTenant.unitType}</strong></div>
                <div><span>Property</span><strong>{viewingTenant.property}</strong></div>
                <div><span>Monthly Rent</span><strong>KSh {Number(viewingTenant.rent.replace(/[^0-9.]/g, '')).toLocaleString()}</strong></div>
                <div><span>Water Bill</span><strong>KSh {Number(viewingTenant.waterBill ?? '0').toLocaleString()}</strong></div>
                <div><span>Lease</span><strong>{viewingTenant.lease}</strong></div>
                {viewingTenant.email && <div><span>Email</span><strong>{viewingTenant.email}</strong></div>}
                {viewingTenant.phone && <div><span>Phone</span><strong>{viewingTenant.phone}</strong></div>}
                {viewingTenant.idNumber && <div><span>ID Number</span><strong>{viewingTenant.idNumber}</strong></div>}
                {viewingTenant.movedIn && <div><span>Moved In</span><strong>{new Date(`${viewingTenant.movedIn}T00:00:00`).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></div>}
                {landlordPaymentMethod === 'paybill' && <div><span>Paybill account number</span><strong>{getPaybillAccountReference(viewingTenant) || viewingTenant.rentAccountRef || 'Not assigned'}</strong></div>}
                {landlordPaymentMethod === 'paybill' && effectiveRentPaybill && <div><span>Landlord Paybill</span><strong>{effectiveRentPaybill}</strong></div>}
                {viewingTenant.portalCode && <div className="tenant-portal-code-detail"><span>Tenant Portal Code</span><strong>{viewingTenant.portalCode}</strong><button type="button" className="portal-code-copy" onClick={() => void copyTenantPortalCode(viewingTenant)}>{copiedPortalCode === viewingTenant.portalCode ? <CheckCircle2 size={14} /> : <Copy size={14} />}{copiedPortalCode === viewingTenant.portalCode ? 'Copied' : 'Copy code'}</button></div>}
                <div><span>Status</span><span className={`access-status ${viewingTenant.status.toLowerCase()}`}>{viewingTenant.status}</span></div>
                <div><span>Payment Status</span><span className={`payment-state ${isPaidForPeriod(viewingTenant) ? 'paid' : 'due'}`}>{isPaidForPeriod(viewingTenant) ? 'Paid this month' : 'Payment due'}</span></div>
              </div>
              <div className="tpm-actions">
                <button className="filter-button" onClick={() => { generateInvoice(viewingTenant); setViewingTenant(null) }}><FileText size={15} /> Generate Invoice</button>
                <button className="cancel-button" onClick={() => setViewingTenant(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
        {/* Edit Tenant Modal */}
        {canAccessSystem && editingTenant && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingTenant(null) }}>
            <form className="add-modal" onSubmit={e => { e.preventDefault(); const leaseEnd = (e.currentTarget.elements.namedItem('leaseEnd') as HTMLInputElement).value || editingTenant.leaseEnd || oneYearAfter(editingTenant.movedIn ?? localDateString()); const updated = { ...editingTenant, name: (e.currentTarget.elements.namedItem('name') as HTMLInputElement).value, email: (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value, phone: (e.currentTarget.elements.namedItem('phone') as HTMLInputElement).value, idNumber: (e.currentTarget.elements.namedItem('idNumber') as HTMLInputElement).value, leaseEnd, lease: `Ends ${new Date(`${leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })}` }; saveEditTenant(updated, editingTenant) }}>
              <button type="button" className="modal-close" onClick={() => setEditingTenant(null)}>×</button>
              <p className="eyebrow">Tenant management</p>
              <h2>Edit tenant</h2>
              <p className="modal-description">Update details for {editingTenant.name}.</p>
              <label className="form-field"><span>Tenant name</span><input required name="name" defaultValue={editingTenant.name} /></label>
              <label className="form-field"><span>Email</span><input type="email" name="email" defaultValue={editingTenant.email ?? ''} /></label>
              <label className="form-field"><span>Mobile number</span><input required type="tel" name="phone" inputMode="numeric" pattern="254[0-9]{9}" maxLength={12} placeholder="254712345678" defaultValue={normalizeKenyanPhone(editingTenant.phone)} /></label>
              <label className="form-field"><span>ID Number</span><input name="idNumber" defaultValue={editingTenant.idNumber ?? ''} /></label>
              <label className="form-field"><span>Lease end date</span><input type="date" name="leaseEnd" defaultValue={editingTenant.leaseEnd ?? (editingTenant.movedIn ? oneYearAfter(editingTenant.movedIn) : oneYearAfter(localDateString()))} /></label>
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setEditingTenant(null)}>Cancel</button>
                <button type="submit" className="primary-button">Save changes</button>
              </div>
            </form>
          </div>
        )}
        {/* Edit Property Modal */}
        {canAccessSystem && editingProperty && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingProperty(null) }}>
            <div className="add-modal">
              <button type="button" className="modal-close" onClick={() => setEditingProperty(null)}>×</button>
              <p className="eyebrow">Property management</p>
              <h2>Edit property</h2>
              <p className="modal-description">Currently viewing {editingProperty.name}. Full property editing coming soon.</p>
              <div className="modal-actions">
                <button type="button" className="primary-button" onClick={() => setEditingProperty(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
        {/* Edit Payment Inline */}
        {canAccessSystem && editingPaymentIdx !== null && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingPaymentIdx(null) }}>
            <form className="add-modal" onSubmit={e => { e.preventDefault(); const parts = (savedRows.Payments ?? [])[editingPaymentIdx].split(' · '); const amount = (e.currentTarget.elements.namedItem('amount') as HTMLInputElement).value; const period = (e.currentTarget.elements.namedItem('period') as HTMLInputElement).value; const newRow = `KSh ${Number(amount).toLocaleString()} · ${parts[1]} · ${parts[2]} · ${parts[3]} · ${(e.currentTarget.elements.namedItem('date') as HTMLInputElement).value} · ${parts[5] ?? 'Payment'} · ${(e.currentTarget.elements.namedItem('reference') as HTMLInputElement).value} · ${period}`; saveEditPayment(newRow, editingPaymentIdx) }}>
              <button type="button" className="modal-close" onClick={() => setEditingPaymentIdx(null)}>×</button>
              <p className="eyebrow">Payment management</p>
              <h2>Edit payment</h2>
              <p className="modal-description">Update payment details.</p>
              {(() => { const parts = (savedRows.Payments ?? [])[editingPaymentIdx].split(' · '); return <><label className="form-field"><span>Amount (KSh)</span><input required type="number" name="amount" defaultValue={parts[0].replace(/[^0-9.]/g, '')} /></label><label className="form-field"><span>Payment date</span><input required type="date" name="date" defaultValue={parts[4] ?? ''} /></label><label className="form-field"><span>Reference</span><input name="reference" defaultValue={parts[6] ?? ''} /></label><label className="form-field"><span>Payment period</span><input name="period" placeholder="e.g. January 2025" defaultValue={parts[7] ?? ''} /></label></> })()}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setEditingPaymentIdx(null)}>Cancel</button>
                <button type="submit" className="primary-button">Save changes</button>
              </div>
            </form>
          </div>
        )}
        {/* Edit Maintenance Inline */}
        {canAccessSystem && editingMaintenanceIdx !== null && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingMaintenanceIdx(null) }}>
            <form className="add-modal" onSubmit={e => { e.preventDefault(); const parts = (savedRows.Maintenance ?? [])[editingMaintenanceIdx].split(' · '); const issue = (e.currentTarget.elements.namedItem('issue') as HTMLInputElement).value; const priority = (e.currentTarget.elements.namedItem('priority') as HTMLSelectElement).value; const newRow = `${parts[0]} · ${issue} · ${parts[2]} · ${parts[3]} · ${parts[4]} · ${priority} priority`; saveEditMaintenance(newRow, editingMaintenanceIdx) }}>
              <button type="button" className="modal-close" onClick={() => setEditingMaintenanceIdx(null)}>×</button>
              <p className="eyebrow">Maintenance management</p>
              <h2>Edit maintenance request</h2>
              <p className="modal-description">Update request details.</p>
              {(() => { const parts = (savedRows.Maintenance ?? [])[editingMaintenanceIdx].split(' · '); return <><label className="form-field"><span>Issue description</span><input required name="issue" defaultValue={parts[1] ?? ''} /></label><label className="form-field"><span>Priority</span><select name="priority" defaultValue={parts[5]?.replace(' priority', '') ?? 'Medium'}><option>High</option><option>Medium</option><option>Low</option></select></label></> })()}
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setEditingMaintenanceIdx(null)}>Cancel</button>
                <button type="submit" className="primary-button">Save changes</button>
              </div>
            </form>
          </div>
        )}
        {/* Edit Expense Modal */}
        {canAccessSystem && editingExpense && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingExpense(null) }}>
            <form className="add-modal" onSubmit={e => { e.preventDefault(); const updated = { ...editingExpense, category: (e.currentTarget.elements.namedItem('category') as HTMLSelectElement).value, amount: Number((e.currentTarget.elements.namedItem('amount') as HTMLInputElement).value), date: (e.currentTarget.elements.namedItem('date') as HTMLInputElement).value, note: (e.currentTarget.elements.namedItem('note') as HTMLInputElement).value }; setExpenses(c => c.map(exp => exp.id === editingExpense.id ? updated : exp)); setEditingExpense(null) }}>
              <button type="button" className="modal-close" onClick={() => setEditingExpense(null)}>×</button>
              <p className="eyebrow">Expense management</p>
              <h2>Edit expense</h2>
              <p className="modal-description">Update expense details.</p>
              <label className="form-field"><span>Category</span><select name="category" defaultValue={editingExpense.category}><option>Repairs</option><option>Utilities</option><option>Cleaning</option><option>Security</option><option>Administration</option><option>Other</option></select></label>
              <label className="form-field"><span>Amount (KSh)</span><input required type="number" name="amount" defaultValue={editingExpense.amount} /></label>
              <label className="form-field"><span>Date</span><input required type="date" name="date" defaultValue={editingExpense.date} /></label>
              <label className="form-field"><span>Note</span><input name="note" defaultValue={editingExpense.note} /></label>
              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={() => setEditingExpense(null)}>Cancel</button>
                <button type="submit" className="primary-button">Save changes</button>
              </div>
            </form>
          </div>
        )}
      </div>
      {/* Subscription Payment Modal */}
      {showSubscriptionModal && (
          <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSubscriptionModal(false) }}>
            <div className="subscription-modal">
              <button type="button" className="modal-close" onClick={() => setShowSubscriptionModal(false)}>×</button>
              <div className="sm-header">
                <span className="sm-icon">💳</span>
                <div><h2>Subscribe to Moha Rental</h2><p>Choose your plan and pay using the platform’s configured method.</p></div>
              </div>
              {sessionUser.subscriptionRequest?.status === 'pending' && <p className="subscription-pending-notice">Your payment reference is waiting for admin verification. You can submit another request after this one is reviewed.</p>}
              
              <div className="sm-plans">
                {sessionUser.userType === 'Landlord' && <article className="sm-plan-card sm-test-plan">
                  <div className="sm-plan-header"><strong>Test Plan</strong><span className="sm-plan-radio">Free</span></div>
                  <div className="sm-plan-price">KSh 0<small>/1 month</small></div>
                  <ul className="sm-plan-features">
                    <li>Full system access for one month</li>
                    <li>Properties, units, and tenant management</li>
                    <li>Rent, water bills, and payment tracking</li>
                    <li>Invoices, tenant portal, and WhatsApp reminders</li>
                    <li>Maintenance, expenses, and monthly CSV reports</li>
                  </ul>
                  <button type="button" className="primary-button" style={{ width: '100%' }} disabled={Boolean(sessionUser.subscription) || sessionUser.subscriptionRequest?.status === 'pending'} onClick={() => void activateTestSubscription()}>
                    {sessionUser.subscription?.plan === 'test' ? 'Test plan already used' : sessionUser.subscription ? 'Subscription already active' : sessionUser.subscriptionRequest?.status === 'pending' ? 'Payment pending review' : 'Start one-month free test'}
                  </button>
                </article>}
                <button 
                  className={`sm-plan-card ${subscriptionForm.plan === 'silver_monthly' ? 'active' : ''}`}
                  onClick={() => setSubscriptionForm({ ...subscriptionForm, plan: 'silver_monthly', amount: 500 })}
                  disabled={sessionUser.subscriptionRequest?.status === 'pending'}
                >
                  <div className="sm-plan-header">
                    <strong>Silver Monthly</strong>
                    <span className="sm-plan-radio">{subscriptionForm.plan === 'silver_monthly' ? '●' : '○'}</span>
                  </div>
                  <div className="sm-plan-price">KSh 500<small>/month</small></div>
                  <ul className="sm-plan-features">
                    <li>Unlimited properties, units, and tenants</li>
                    <li>Rent, water bills, and payment tracking</li>
                    <li>Invoices, tenant portal, and WhatsApp reminders</li>
                    <li>Maintenance, expenses, and applicant management</li>
                    <li>Monthly CSV reports and team access</li>
                  </ul>
                </button>
                
                <button 
                  className={`sm-plan-card ${subscriptionForm.plan === 'silver_yearly' ? 'active' : ''} featured`}
                  onClick={() => setSubscriptionForm({ ...subscriptionForm, plan: 'silver_yearly', amount: 4500 })}
                  disabled={sessionUser.subscriptionRequest?.status === 'pending'}
                >
                  <span className="sm-plan-badge">Best Value</span>
                  <div className="sm-plan-header">
                    <strong>Silver Yearly</strong>
                    <span className="sm-plan-radio">{subscriptionForm.plan === 'silver_yearly' ? '●' : '○'}</span>
                  </div>
                  <div className="sm-plan-price">KSh 4,500<small>/year</small></div>
                  <div className="sm-plan-save">Save KSh 1,500 vs monthly</div>
                  <ul className="sm-plan-features">
                    <li>All Silver Monthly features</li>
                    <li>12 months of system access</li>
                    <li>Priority support</li>
                    <li>Advanced reports and backup</li>
                  </ul>
                </button>
              </div>

              <div className="sm-payment">
                <h3>Payment Instructions</h3>
                <div className="sm-steps">
                  <div className="sm-step">
                    <span className="sm-step-num">1</span>
                    <div>
                      <strong>{subscriptionPaymentDetails.method === 'bank_transfer' ? 'Make a bank transfer' : 'Open M-Pesa on your phone'}</strong>
                      <small>{subscriptionPaymentDetails.method === 'bank_transfer' ? 'Use the bank account details below.' : 'Choose Lipa na M-Pesa and follow the payment instructions below.'}</small>
                    </div>
                  </div>
                  {subscriptionPaymentDetails.method === 'paybill' && <div className="sm-step">
                    <span className="sm-step-num">2</span>
                    <div>
                      <strong>Paybill number: {subscriptionPaymentDetails.paybillNumber || 'Not configured'}</strong>
                      <small>Use your National ID number as the account reference.</small>
                    </div>
                  </div>}
                  {subscriptionPaymentDetails.method === 'till' && <div className="sm-step">
                    <span className="sm-step-num">2</span>
                    <div><strong>Buy Goods and Services</strong><small>Till number: <strong>{subscriptionPaymentDetails.tillNumber || 'Not configured'}</strong>. No account number is required.</small></div>
                  </div>}
                  {subscriptionPaymentDetails.method === 'bank_transfer' && <div className="sm-step">
                    <span className="sm-step-num">2</span>
                    <div><strong>{subscriptionPaymentDetails.bankName || 'Bank'} · {subscriptionPaymentDetails.bankAccountName || 'Account name'}</strong><small>Account number: <strong>{subscriptionPaymentDetails.bankAccountNumber || 'Not configured'}</strong></small></div>
                  </div>}
                  <div className="sm-step">
                    <span className="sm-step-num">{subscriptionPaymentDetails.method === 'bank_transfer' ? '3' : '3'}</span>
                    <div>
                      <strong>Pay KSh {subscriptionForm.amount.toLocaleString()}</strong>
                      <small>{subscriptionPaymentDetails.method === 'bank_transfer' ? 'Use your bank transaction reference below.' : 'Keep your payment confirmation reference.'}</small>
                    </div>
                  </div>
                  <div className="sm-step">
                    <span className="sm-step-num">4</span>
                    <div>
                      <strong>Enter your payment reference below</strong>
                      <small>Admin will verify the payment before activating your subscription.</small>
                    </div>
                  </div>
                </div>

                <form className="sm-form" onSubmit={async (e) => {
                  e.preventDefault()
                  if (!subscriptionForm.mpesaCode.trim() || !subscriptionPaymentDestinationConfigured || sessionUser.subscriptionRequest?.status === 'pending') return
                  if (!supabase) { setSubscriptionFeedback('Supabase is not configured.'); return }
                  setSubscriptionFeedback('Submitting payment reference...')
                  const { data: request, error } = await supabase.from('subscription_payment_requests').insert({
                    user_id: sessionUser.id,
                    plan: subscriptionForm.plan,
                    amount: subscriptionForm.amount,
                    mpesa_code: subscriptionForm.mpesaCode.trim().toUpperCase(),
                    payment_method: subscriptionPaymentDetails.method,
                  }).select('id, plan, amount, mpesa_code, payment_method, status, submitted_at, reviewed_at').single()
                  if (error) { setSubscriptionFeedback(error.message); return }
                  const updatedUser = {
                    ...sessionUser,
                    subscriptionRequest: {
                      id: request.id,
                      plan: request.plan as SubscriptionRequestPlan,
                      amount: request.amount,
                      mpesaCode: request.mpesa_code,
                      paymentMethod: request.payment_method as LandlordPaymentMethod,
                      submittedAt: request.submitted_at,
                      status: request.status as 'pending' | 'approved' | 'rejected',
                      reviewedAt: request.reviewed_at ?? undefined,
                    }
                  }
                  setUsers(c => c.map(u => u.id === sessionUser.id ? updatedUser : u))
                  setSessionUser(updatedUser)
                  setShowSubscriptionModal(false)
                  setSubscriptionFeedback('')
                  setSubscriptionForm({ plan: 'silver_monthly', mpesaCode: '', amount: 500 })
                }}>
                  {sessionUser.subscriptionRequest?.status === 'pending' && <p className="subscription-pending-notice">Your payment reference has been submitted and is waiting for admin verification.</p>}
                  {subscriptionPaymentSettingsLoading && <p className="subscription-review-note">Loading the latest subscription payment instructions...</p>}
                  {!subscriptionPaymentSettingsLoading && subscriptionPaymentSettingsError && <p className="login-error">Subscription payment settings are unavailable. Contact the platform administrator.</p>}
                  {!subscriptionPaymentSettingsLoading && !subscriptionPaymentSettingsError && !subscriptionPaymentDestinationConfigured && <p className="subscription-pending-notice">The platform administrator has not finished configuring subscription payment details.</p>}
                  <label className="form-field">
                    <span>{subscriptionPaymentDetails.method === 'bank_transfer' ? 'Bank transfer reference' : 'M-Pesa transaction code'}</span>
                    <input 
                      required 
                    disabled={subscriptionPaymentSettingsLoading || sessionUser.subscriptionRequest?.status === 'pending'}
                      placeholder={subscriptionPaymentDetails.method === 'bank_transfer' ? 'e.g., bank transaction reference' : 'e.g., QWE123ABCD'}
                      value={subscriptionForm.mpesaCode}
                      onChange={e => setSubscriptionForm({ ...subscriptionForm, mpesaCode: e.target.value })}
                    />
                  </label>
                  {subscriptionFeedback && <p className={subscriptionFeedback.startsWith('Submitting') ? 'subscription-review-note' : 'login-error'}>{subscriptionFeedback}</p>}
                  
                  <div className="sm-summary">
                    <div><span>Plan</span><strong>{subscriptionForm.plan === 'silver_monthly' ? 'Silver monthly' : 'Silver yearly'}</strong></div>
                    <div><span>Amount</span><strong>KSh {subscriptionForm.amount.toLocaleString()}</strong></div>
                    <div><span>Valid for</span><strong>{subscriptionForm.plan === 'silver_monthly' ? '1 month' : '1 year'}</strong></div>
                  </div>

                  <div className="modal-actions" style={{ marginTop: 20 }}>
                    <button type="button" className="cancel-button" onClick={() => setShowSubscriptionModal(false)}>Cancel</button>
                    <button type="submit" className="primary-button" disabled={subscriptionPaymentSettingsLoading || !subscriptionPaymentDestinationConfigured || Boolean(subscriptionPaymentSettingsError) || sessionUser.subscriptionRequest?.status === 'pending'}
                      >{sessionUser.subscriptionRequest?.status === 'pending' ? 'Waiting for verification' : 'Submit for verification'}</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
    </main>
  </div>
  </ConfirmedRentPaymentsContext.Provider></ConfirmedRentPaymentRefreshContext.Provider></TenantDirectoryContext.Provider></LandlordPaybillContext.Provider>
}

function PlatformAdminPortfolioDashboard({ workspaces, landlordAccountCount, loading, error, onRefresh }: { workspaces: PlatformLandlordWorkspace[]; landlordAccountCount: number; loading: boolean; error: string; onRefresh: () => void }) {
  const [selectedLandlordId, setSelectedLandlordId] = useState<string | null>(null)
  const [selectedPropertyName, setSelectedPropertyName] = useState<string | null>(null)
  const [landlordPage, setLandlordPage] = useState(1)
  const [caretakerPage, setCaretakerPage] = useState(1)
  const pageSize = 12
  const selectedWorkspace = workspaces.find(workspace => workspace.landlord.id === selectedLandlordId) ?? null
  const getWorkspaceStats = (workspace: PlatformLandlordWorkspace) => {
    const properties = Array.isArray(workspace.data.properties) ? workspace.data.properties : []
    const tenants = Array.isArray(workspace.data.tenants) ? workspace.data.tenants : []
    const unitMap = workspace.data.units && typeof workspace.data.units === 'object' ? workspace.data.units : {}
    const propertyUnitTotal = properties.reduce((sum, property) => sum + Number(property.units || 0), 0)
    const propertyOccupiedTotal = properties.reduce((sum, property) => sum + Number(property.occupied || 0), 0)
    const derivedUnitTotal = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.length : 0), 0)
    const derivedOccupiedTotal = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => unit.status === 'Occupied' || Boolean(unit.tenant)).length : 0), 0)
    const derivedTenantTotal = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => Boolean(unit.tenant)).length : 0), 0)
    const totalUnits = propertyUnitTotal || derivedUnitTotal
    const occupiedUnits = propertyOccupiedTotal || derivedOccupiedTotal
    const rentRoll = properties.reduce((sum, property) => sum + (Number(String(property.income ?? '').replace(/[^0-9.]/g, '')) || 0), 0)
    const hasAnyData = properties.length > 0 || tenants.length > 0 || derivedUnitTotal > 0 || derivedTenantTotal > 0 || Boolean(workspace.updatedAt)
    return { properties, tenants, totalUnits, occupiedUnits, rentRoll, derivedTenantTotal, hasAnyData }
  }
  const totalProperties = workspaces.reduce((total, workspace) => total + getWorkspaceStats(workspace).properties.length, 0)
  const totalUnits = workspaces.reduce((total, workspace) => total + getWorkspaceStats(workspace).totalUnits, 0)
  const totalOccupied = workspaces.reduce((total, workspace) => total + getWorkspaceStats(workspace).occupiedUnits, 0)
  const totalTenants = workspaces.reduce((total, workspace) => total + getWorkspaceStats(workspace).tenants.length, 0)
  const totalRentRoll = workspaces.reduce((total, workspace) => total + getWorkspaceStats(workspace).rentRoll, 0)
  const allCaretakerAssignments = workspaces.flatMap(workspace => workspace.caretakerAssignments)
  const totalCaretakers = new Set(workspaces.flatMap(workspace => [
    ...workspace.caretakers.map(caretaker => caretaker.id),
    ...workspace.caretakerAssignments.map(assignment => assignment.caretakerId),
  ])).size
  const caretakerDirectory = workspaces.flatMap(workspace => workspace.caretakers.map(caretaker => ({
    ...caretaker,
    landlord: workspace.landlord,
    assignments: workspace.caretakerAssignments.filter(assignment => assignment.caretakerId === caretaker.id),
  })))
  const landlordPageCount = Math.max(1, Math.ceil(workspaces.length / pageSize))
  const currentLandlordPage = Math.min(landlordPage, landlordPageCount)
  const visibleWorkspaces = workspaces.slice((currentLandlordPage - 1) * pageSize, currentLandlordPage * pageSize)
  const caretakerPageCount = Math.max(1, Math.ceil(caretakerDirectory.length / pageSize))
  const currentCaretakerPage = Math.min(caretakerPage, caretakerPageCount)
  const visibleCaretakers = caretakerDirectory.slice((currentCaretakerPage - 1) * pageSize, currentCaretakerPage * pageSize)
  const allCollected = workspaces.reduce((total, workspace) => total + (workspace.data.records?.Payments ?? []).reduce((sum, row) => sum + (Number((row.split(' · ')[0] ?? '').replace(/[^0-9.]/g, '')) || 0), 0) + workspace.directPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0), 0)

  if (selectedWorkspace) {
    const data = selectedWorkspace.data
    const properties = Array.isArray(data.properties) ? data.properties : []
    const tenants = Array.isArray(data.tenants) ? data.tenants : []
    const payments = data.records?.Payments ?? []
    const maintenance = data.records?.Maintenance ?? []
    const unitMap = data.units && typeof data.units === 'object' ? data.units : {}
    const derivedUnitCount = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.length : 0), 0)
    const derivedOccupied = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => unit.status === 'Occupied' || Boolean(unit.tenant)).length : 0), 0)
    const derivedTenantCount = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => Boolean(unit.tenant)).length : 0), 0)
    const hasAnyData = properties.length > 0 || tenants.length > 0 || derivedUnitCount > 0 || derivedTenantCount > 0 || Boolean(selectedWorkspace.updatedAt)
    const collected = payments.reduce((sum, row) => sum + (Number((row.split(' · ')[0] ?? '').replace(/[^0-9.]/g, '')) || 0), 0) + selectedWorkspace.directPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    const rentRoll = properties.reduce((sum, property) => sum + (Number(String(property.income ?? '').replace(/[^0-9.]/g, '')) || 0), 0)
    const unitCount = properties.reduce((sum, property) => sum + Number(property.units || 0), 0) || derivedUnitCount
    const occupied = properties.reduce((sum, property) => sum + Number(property.occupied || 0), 0) || derivedOccupied
    const openMaintenance = maintenance.filter(row => !data.maintenance?.[row]).length
    const expiringCutoff = new Date()
    expiringCutoff.setDate(expiringCutoff.getDate() + 60)
    const expiringLeases = tenants.filter(tenant => tenant.leaseEnd && new Date(`${tenant.leaseEnd}T00:00:00`) <= expiringCutoff)
    const property = properties.find(item => item.name === selectedPropertyName)

    if (property) return <PropertyUnitsView
      propertyName={property.name}
      property={property}
      units={data.units?.[property.name] ?? []}
      tenants={tenants.filter(tenant => tenant.property === property.name)}
      payments={payments.filter(row => row.includes(property.name))}
      maintenance={maintenance.filter(row => row.includes(property.name))}
      completedMaintenance={data.maintenance ?? {}}
      onBack={() => setSelectedPropertyName(null)}
    />

    const recentPayments = [
      ...payments.map(row => ({ label: row, landlord: selectedWorkspace.landlord.name, date: row.split(' · ')[4] ?? '', amount: row.split(' · ')[0] ?? '' })),
      ...selectedWorkspace.directPayments.map(payment => ({ label: payment.mpesa_receipt, landlord: selectedWorkspace.landlord.name, date: new Date(payment.transacted_at).toLocaleDateString('en-KE'), amount: `KSh ${Number(payment.amount).toLocaleString()}` })),
    ].slice(-6).reverse()

    const tenantCount = tenants.length || derivedTenantCount
    return <section className="platform-portfolio-detail">
      <button type="button" className="back-link" onClick={() => { setSelectedLandlordId(null); setSelectedPropertyName(null) }}><ArrowUpRight size={15} className="back-icon" /> All landlords</button>
      <header className="platform-portfolio-landlord-heading">
        <div><p className="eyebrow">LANDLORD OVERVIEW</p><h2>{selectedWorkspace.landlord.name}</h2><p>{selectedWorkspace.landlord.email ?? selectedWorkspace.landlord.username}</p></div>
        <span className={`access-status ${selectedWorkspace.landlord.active ? 'connected' : 'disconnected'}`}>{selectedWorkspace.landlord.active ? 'Active account' : 'Suspended'}</span>
      </header>
      {!hasAnyData && <p className="overview-empty">This landlord has not added a property yet.</p>}
      <section className="metric-grid platform-portfolio-metrics" aria-label="Landlord portfolio summary">
        <article className="metric-card featured"><div className="metric-top"><span className="metric-icon"><Building2 size={18} /></span><span className="trend positive">Portfolio</span></div><p>Properties</p><strong>{properties.length}</strong><small>{unitCount} total units</small></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon mint"><Users size={18} /></span><span className="trend positive">Live</span></div><p>Residents</p><strong>{tenantCount}</strong><small>{occupied} occupied units</small></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon peach"><TrendingUp size={18} /></span><span className="trend positive">Monthly</span></div><p>Rent roll</p><strong>KSh {rentRoll.toLocaleString()}</strong><small>{unitCount - occupied} vacant units</small></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon lavender"><CircleDollarSign size={18} /></span><span className="trend positive">Recorded</span></div><p>Payments received</p><strong>KSh {collected.toLocaleString()}</strong><small>{payments.length + selectedWorkspace.directPayments.length} payment records</small></article>
      </section>
      <section className="panel platform-portfolio-properties">
        <div className="panel-heading"><div><p className="eyebrow">LANDLORD PORTFOLIO</p><h2>Properties</h2></div><span className="live-badge">{properties.length} listed</span></div>
        <div className="platform-property-list">{properties.map(item => <button className="platform-property-row" key={item.name} type="button" onClick={() => setSelectedPropertyName(item.name)}>
          <span className={`property-thumb ${item.color}`}><Building2 size={18} /></span>
          <span className="platform-property-name"><strong>{item.name}</strong><small>{item.address}</small></span>
          <span><strong>{item.occupied} / {item.units}</strong><small>Occupied</small></span>
          <span><strong>{item.income}</strong><small>Monthly rent roll</small></span>
          <span className={`status ${item.status.toLowerCase()}`}>{item.status}</span>
          <ArrowUpRight size={17} />
        </button>)}</div>
      </section>
      <section className="panel platform-portfolio-properties">
        <div className="panel-heading"><div><p className="eyebrow">TEAM COVERAGE</p><h2>Caretakers</h2></div><span className="live-badge">{selectedWorkspace.caretakers.length} accounts</span></div>
        <div className="platform-caretaker-list">{selectedWorkspace.caretakers.map(caretaker => {
          const assignments = selectedWorkspace.caretakerAssignments.filter(assignment => assignment.caretakerId === caretaker.id)
          return <div key={caretaker.id}>
            <span className="user-avatar">{caretaker.name.slice(0, 2).toUpperCase()}</span>
            <span><strong>{caretaker.name}</strong><small>{caretaker.email ?? 'Caretaker account'}</small></span>
            <span><strong>{assignments.length ? assignments.map(assignment => assignment.property).join(', ') : 'Unassigned'}</strong><small>{assignments.length ? assignments.map(assignment => `Unit ${assignment.unit}`).join(', ') : 'No property/unit assignment recorded'}</small></span>
          </div>
        })}{!selectedWorkspace.caretakers.length && <p className="overview-empty">No caretaker accounts found for this landlord.</p>}</div>
      </section>
      <section className="dashboard-grid platform-portfolio-lower">
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">RESIDENTS</p><h2>Tenants</h2></div><span className="live-badge">{tenants.length}</span></div>
          <div className="platform-tenant-list">{tenants.slice(0, 8).map(tenant => <div key={`${tenant.property}-${tenant.unit}-${tenant.name}`}><span className="user-avatar">{tenant.name.slice(0, 2).toUpperCase()}</span><span><strong>{tenant.name}</strong><small>{tenant.property} · {getTenantUnitLabel(tenant)}</small></span><span>KSh {Number(tenant.rent.replace(/[^0-9.]/g, '')).toLocaleString()}</span></div>)}{!tenants.length && <p className="overview-empty">No tenants listed.</p>}</div>
        </article>
        <article className="panel"><div className="panel-heading"><div><p className="eyebrow">OPERATIONS</p><h2>Portfolio health</h2></div></div>
          <div className="platform-health-summary"><div><strong>{unitCount ? Math.round(occupied / unitCount * 100) : 0}%</strong><small>Occupancy</small></div><div><strong>{unitCount - occupied}</strong><small>Vacant units</small></div><div><strong>{openMaintenance}</strong><small>Open maintenance</small></div><div><strong>{expiringLeases.length}</strong><small>Leases due in 60 days</small></div></div>
          <div className="platform-recent-payments">{recentPayments.map(payment => <div key={`${payment.label}-${payment.date}`}><span><strong>{payment.amount}</strong><small>{payment.label} · {payment.landlord}</small></span><time>{payment.date}</time></div>)}{!recentPayments.length && <p className="overview-empty">No payment records yet.</p>}</div>
        </article>
      </section>
    </section>
  }

  return <section className="platform-portfolio-dashboard">
    <div className="platform-portfolio-intro"><div><p className="eyebrow">PLATFORM ADMINISTRATION</p><h2>Landlord portfolio</h2><p>Read-only performance overview across landlord workspaces.</p></div><div className="platform-portfolio-actions"><span className="live-badge">{loading ? 'Updating portfolio' : `${workspaces.length} landlords`}</span><button type="button" className="filter-button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'platform-refresh-spinning' : ''} /> {loading ? 'Refreshing…' : 'Refresh portfolio'}</button></div></div>
    <section className="metric-grid platform-portfolio-metrics" aria-label="All landlord portfolio metrics">
      <article className="metric-card featured"><div className="metric-top"><span className="metric-icon"><Building2 size={18} /></span><span className="trend positive">All landlords</span></div><p>Properties</p><strong>{totalProperties}</strong><small>Across {workspaces.length} landlord workspaces</small></article>
      <article className="metric-card"><div className="metric-top"><span className="metric-icon mint"><Users size={18} /></span><span className="trend positive">Portfolio</span></div><p>Residents</p><strong>{totalTenants}</strong><small>{totalOccupied} occupied of {totalUnits} units</small></article>
      <article className="metric-card"><div className="metric-top"><span className="metric-icon peach"><TrendingUp size={18} /></span><span className="trend positive">Monthly</span></div><p>Rent roll</p><strong>KSh {totalRentRoll.toLocaleString()}</strong><small>{totalUnits - totalOccupied} vacant units</small></article>
      <article className="metric-card"><div className="metric-top"><span className="metric-icon lavender"><CircleDollarSign size={18} /></span><span className="trend positive">Recorded</span></div><p>Payments received</p><strong>KSh {allCollected.toLocaleString()}</strong><small>Across all loaded workspaces</small></article>
      <article className="metric-card"><div className="metric-top"><span className="metric-icon mint"><Wrench size={18} /></span><span className="trend positive">Team</span></div><p>Caretakers</p><strong>{totalCaretakers}</strong><small>{allCaretakerAssignments.length} active property/unit assignments</small></article>
    </section>
    <div className="platform-landlord-list-heading"><div><p className="eyebrow">WORKSPACES</p><h2>Landlords</h2></div><span>{workspaces.length} accounts</span></div>
    {loading && <p className="overview-empty">Loading landlord workspaces…</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
    {!loading && !workspaces.length && <p className="overview-empty">{landlordAccountCount ? 'Landlord accounts were found, but no workspace data is available to show yet.' : 'No Landlord accounts were found under this Platform Administrator. Landlords invited by another platform account will not appear here.'}</p>}
    <div className="platform-landlord-list">{visibleWorkspaces.map(workspace => {
      const properties = Array.isArray(workspace.data.properties) ? workspace.data.properties : []
      const unitMap = workspace.data.units && typeof workspace.data.units === 'object' ? workspace.data.units : {}
      const derivedUnits = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.length : 0), 0)
      const derivedOccupiedUnits = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => unit.status === 'Occupied' || Boolean(unit.tenant)).length : 0), 0)
      const derivedTenantCount = Object.values(unitMap).reduce((sum, units) => sum + (Array.isArray(units) ? units.filter(unit => Boolean(unit.tenant)).length : 0), 0)
      const landlordTenantCount = Array.isArray(workspace.data.tenants) ? workspace.data.tenants.length || derivedTenantCount : derivedTenantCount
      const units = properties.reduce((sum, property) => sum + Number(property.units || 0), 0) || derivedUnits
      const occupied = properties.reduce((sum, property) => sum + Number(property.occupied || 0), 0) || derivedOccupiedUnits
      const rentRoll = properties.reduce((sum, property) => sum + (Number(String(property.income ?? '').replace(/[^0-9.]/g, '')) || 0), 0)
      const hasAnyData = properties.length > 0 || landlordTenantCount > 0 || derivedUnits > 0 || Boolean(workspace.updatedAt)
      return <article className="platform-landlord-row" key={workspace.landlord.id}>
        <div className="platform-landlord-identity"><span className="user-avatar">{workspace.landlord.name.slice(0, 2).toUpperCase()}</span><span><strong>{workspace.landlord.name}</strong><small>{workspace.landlord.email ?? workspace.landlord.username}</small></span><span className={`access-status ${workspace.landlord.active ? 'connected' : 'disconnected'}`}>{workspace.landlord.active ? 'Active' : 'Suspended'}</span></div>
        <div className="platform-landlord-stats"><span><strong>{properties.length}</strong><small>Properties</small></span><span><strong>{units}</strong><small>Units</small></span><span><strong>{landlordTenantCount}</strong><small>Tenants</small></span><span><strong>{units ? Math.round(occupied / units * 100) : 0}%</strong><small>Occupancy</small></span><span><strong>KSh {rentRoll.toLocaleString()}</strong><small>Monthly rent roll</small></span><span><strong>{workspace.caretakers.length}</strong><small>Caretakers</small></span></div>
        <div className="platform-landlord-properties">{properties.length ? properties.map(property => <span key={property.name}><Building2 size={14} /><strong>{property.name}</strong><small>{property.occupied}/{property.units} units · {property.income}/mo</small></span>) : <small>{hasAnyData ? 'Workspace has unit data available but no property summary yet.' : 'Workspace not initialized yet.'}</small>}</div>
        {workspace.caretakers.length > 0 && <div className="platform-landlord-caretakers">{workspace.caretakers.map(caretaker => {
          const assignments = workspace.caretakerAssignments.filter(assignment => assignment.caretakerId === caretaker.id)
          return <span key={caretaker.id}><Wrench size={13} /><strong>{caretaker.name}</strong><small>{assignments.length ? assignments.map(assignment => `${assignment.property} · Unit ${assignment.unit}`).join(', ') : 'No property/unit assignment recorded'}</small></span>
        })}</div>}
        <button type="button" className="filter-button platform-view-landlord" onClick={() => { setSelectedLandlordId(workspace.landlord.id); setSelectedPropertyName(null) }}>Open landlord overview <ArrowUpRight size={16} /></button>
      </article>
    })}</div>
    {workspaces.length > pageSize && <Pagination page={currentLandlordPage} pageCount={landlordPageCount} onPageChange={setLandlordPage} />}
    <div className="platform-landlord-list-heading"><div><p className="eyebrow">TEAM DIRECTORY</p><h2>Caretakers</h2></div><span>{caretakerDirectory.length} accounts</span></div>
    {caretakerDirectory.length ? <div className="platform-landlord-list">{visibleCaretakers.map(caretaker => (
      <article className="platform-landlord-row platform-caretaker-directory-row" key={caretaker.id}>
        <div className="platform-landlord-identity"><span className="user-avatar">{caretaker.name.slice(0, 2).toUpperCase()}</span><span><strong>{caretaker.name}</strong><small>{caretaker.email ?? 'Caretaker account'} · Landlord: {caretaker.landlord.name}</small></span><span className="live-badge">{caretaker.assignments.length} assignments</span></div>
        <div className="platform-landlord-caretakers">{caretaker.assignments.length ? caretaker.assignments.map((assignment, index) => <span key={`${assignment.property}-${assignment.unit}-${index}`}><Wrench size={13} /><strong>{assignment.property}</strong><small>Unit {assignment.unit}</small></span>) : <span><Wrench size={13} /><strong>Unassigned</strong><small>No property/unit assignment recorded</small></span>}</div>
      </article>
    ))}</div> : !loading && <p className="overview-empty">No caretaker accounts are linked to these landlord workspaces yet.</p>}
    {caretakerDirectory.length > pageSize && <Pagination page={currentCaretakerPage} pageCount={caretakerPageCount} onPageChange={setCaretakerPage} />}
  </section>
}

function SectionView({ section, rows, completedMaintenance = {}, onAdd, onRowClick, onWaterBillUpdate, onGenerateInvoice, onRemoveTenant, onOpenMaintenance, onEditProperty, onDeleteProperty, onViewTenantProfile, onEditTenant, onEditPayment, onDeletePayment, onEditMaintenance, onDeleteMaintenance, onMarkMaintenanceDone }: { section: string; rows: string[]; completedMaintenance?: Record<string, boolean>; showConfirmedRentPayments?: boolean; onAdd: (() => void) | null; onRowClick?: (index: number) => void; onWaterBillUpdate?: (index: number) => void; onGenerateInvoice?: (index: number) => void; onRemoveTenant?: (index: number) => void; onOpenMaintenance?: (index: number) => void; onEditProperty?: (index: number) => void; onDeleteProperty?: (index: number) => void; onViewTenantProfile?: (index: number) => void; onEditTenant?: (index: number) => void; onEditPayment?: (index: number) => void; onDeletePayment?: (index: number) => void; onEditMaintenance?: (index: number) => void; onDeleteMaintenance?: (index: number) => void; onMarkMaintenanceDone?: (index: number) => void }) {
  const directRentPayments = useContext(ConfirmedRentPaymentsContext)
  const tenantDirectory = useContext(TenantDirectoryContext)
  const detail = sectionDetails[section]
  const addLabel = section === 'Properties' ? 'property' : section === 'Help center' ? 'topic' : section.slice(0, -1).toLowerCase()
  const pageSize = 15
  const [page, setPage] = useState(1)
  const [tenantSearch, setTenantSearch] = useState('')
  const tenantRows = rows.map((row, index) => ({ row, index })).filter(({ row, index }) => {
    if (section !== 'Tenants' || !tenantSearch.trim()) return true
    const tenant = tenantDirectory[index]
    return `${row} ${tenant?.email ?? ''} ${tenant?.portalCode ?? ''} ${tenant?.rentAccountRef ?? ''}`.toLowerCase().includes(tenantSearch.trim().toLowerCase())
  })
  const filteredRows = section === 'Tenants' ? tenantRows.map(({ row }) => row) : rows
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const start = (currentPage - 1) * pageSize
  const visibleTenantIndices = section === 'Tenants' ? tenantRows.slice(start, start + pageSize).map(({ index }) => index) : undefined
  const pageRows = filteredRows.slice(start, start + pageSize)
  return <section className={`section-view panel ${section.toLowerCase()}-view`}>
    <div className="section-view-heading"><div><p className="eyebrow">{detail.eyebrow}</p><h2>{detail.title}</h2><p>{detail.description}</p></div>{section === 'Tenants' && <label className="search-box tenant-directory-search"><Search size={16} /><input value={tenantSearch} onChange={event => { setTenantSearch(event.target.value); setPage(1) }} placeholder="Search name, property, email or code" aria-label="Search tenants by name, property, email or portal code" /></label>}{onAdd && <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add {addLabel}</button>}</div>
    {section === 'Properties' && <PropertySection rows={pageRows} onRowClick={(index) => onRowClick?.(start + index)} onEdit={(index) => onEditProperty?.(start + index)} onDelete={(index) => onDeleteProperty?.(start + index)} />}
    {section === 'Tenants' && <TenantPortalCodeLookup />}
    {section === 'Tenants' && <TenantSection rows={pageRows} originalIndices={visibleTenantIndices} onWaterBillUpdate={(index) => onWaterBillUpdate?.(index)} onGenerateInvoice={(index) => onGenerateInvoice?.(index)} onRemoveTenant={(index) => onRemoveTenant?.(index)} onViewProfile={(index) => onViewTenantProfile?.(index)} onEditTenant={(index) => onEditTenant?.(index)} />}
    {section === 'Maintenance' && <MaintenanceSection rows={pageRows} completedMaintenance={completedMaintenance} onOpen={(index) => onOpenMaintenance?.(start + index)} onEdit={(index) => onEditMaintenance?.(start + index)} onDelete={(index) => onDeleteMaintenance?.(start + index)} onMarkDone={(index) => onMarkMaintenanceDone?.(start + index)} />}
    {section === 'Payments' && <PaymentSection rows={pageRows} onEdit={(index) => onEditPayment?.(start + index)} onDelete={(index) => onDeletePayment?.(start + index)} />}
    {section === 'Payments' && <ConfirmedRentPaymentSection payments={directRentPayments} />}
    {section === 'Documents' && <DocumentSection rows={pageRows} />}
    <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />
  </section>
}

function Pagination({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return <div className="pagination"><span>Page {page} of {pageCount}</span><div><button disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button><button disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next</button></div></div>
}

function PropertySection({ rows, onRowClick, onEdit, onDelete }: { rows: string[]; onRowClick?: (index: number) => void; onEdit?: (index: number) => void; onDelete?: (index: number) => void }) {
  return <div className="section-card-grid">{rows.map((row, index) => { const [name, details = ''] = row.split(' · '); return <div className="property-section-card-wrapper" key={`${row}-${index}`}><button className="property-section-card" onClick={() => onRowClick?.(index)}><span className="property-card-icon"><Building2 size={20} /></span><span><strong>{name}</strong><small>{details}</small></span><ArrowUpRight size={16} /></button>{(onEdit || onDelete) && <div className="card-actions"><button className="card-edit-btn" onClick={(e) => { e.stopPropagation(); onEdit?.(index) }} title="Edit property">✏️</button><button className="card-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete?.(index) }} title="Delete property">🗑️</button></div>}</div> })}</div>
}

function TenantPortalCodeLookup() {
  const tenants = useContext(TenantDirectoryContext)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const searchTerm = query.trim().toLowerCase()
  const matches = tenants.filter(tenant => `${tenant.name} ${tenant.property} ${tenant.unit} ${tenant.email ?? ''} ${tenant.portalCode ?? ''}`.toLowerCase().includes(searchTerm)).slice(0, 8)

  const copyCode = async (tenant: TenantRecord) => {
    if (!tenant.portalCode) return
    try {
      await navigator.clipboard.writeText(tenant.portalCode)
      setCopied(tenant.portalCode)
      setCopyError('')
      window.setTimeout(() => setCopied(''), 1800)
    } catch {
      setCopyError('Clipboard access is unavailable. Open the tenant profile to select the code.')
    }
  }

  return <section className="tenant-code-lookup" aria-labelledby="tenant-code-title">
    <div className="tenant-code-lookup-heading"><div><p className="eyebrow">Tenant access</p><h3 id="tenant-code-title">Portal code lookup</h3><p>Find a tenant and share their portal code if they forget it.</p></div><KeyRoundIcon /></div>
    <label className="search-box tenant-code-search"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tenant, property, unit, email or code" aria-label="Search tenants for portal code" /></label>
    {copyError && <p className="settings-error" role="alert">{copyError}</p>}
    {tenants.length === 0 ? <p className="overview-empty">Add a tenant to generate a portal code.</p> : matches.length === 0 ? <p className="overview-empty">No tenant matches that search.</p> : <div className="tenant-code-results">{matches.map(tenant => <article className="tenant-code-result" key={`${tenant.property}-${tenant.unit}-${tenant.email ?? tenant.name}`}>
      <span className="user-avatar">{tenant.name.slice(0, 2).toUpperCase()}</span>
      <div className="tenant-code-result-info"><strong>{tenant.name}</strong><small>{tenant.property} · Unit {getTenantUnitLabel(tenant)}{tenant.email ? ` · ${tenant.email}` : ''}</small></div>
      <div className="tenant-code-value"><small>Portal code</small><strong>{tenant.portalCode || 'Not set'}</strong></div>
      {tenant.portalCode && <button type="button" className="portal-code-copy" onClick={() => void copyCode(tenant)}>{copied === tenant.portalCode ? <CheckCircle2 size={13} /> : <Copy size={13} />}{copied === tenant.portalCode ? 'Copied' : 'Copy code'}</button>}
    </article>)}</div>}
    {tenants.length > matches.length && <small className="tenant-code-more">Showing {matches.length} matching tenants. Refine your search to narrow the list.</small>}
  </section>
}

function KeyRoundIcon() {
  return <span className="tenant-code-key-mark" aria-hidden="true"><ShieldCheck size={18} /></span>
}

function TenantSection({ rows, originalIndices, onWaterBillUpdate, onGenerateInvoice, onRemoveTenant, onViewProfile, onEditTenant }: { rows: string[]; originalIndices?: number[]; onWaterBillUpdate: (index: number) => void; onGenerateInvoice: (index: number) => void; onRemoveTenant: (index: number) => void; onViewProfile?: (index: number) => void; onEditTenant?: (index: number) => void }) {
  const [copiedPortalCode, setCopiedPortalCode] = useState('')
  const tenantDirectory = useContext(TenantDirectoryContext)
  return <div className="records-table">
    <div className="records-table-head"><span aria-hidden="true"></span><span>Tenant</span><span>Unit and apartment</span><span>Water bill</span><span>Status</span><span>Actions</span></div>
    {rows.map((row, index) => {
      const recordIndex = originalIndices?.[index] ?? index
      const [name, unit = '', type = '', rent = '', property = '', waterBill = '0', email = '', portalCode = ''] = row.split(' · ')
      const unitLabel = getTenantUnitLabel(tenantDirectory[recordIndex] ?? { unit })
      return <div className="tenant-record" key={`${row}-${recordIndex}`}>
        <span className="user-avatar">{name.slice(0, 2).toUpperCase()}</span>
        <span className="tenant-record-main">
          <strong>{name}</strong>
          <small>{property || 'Apartment not specified'}</small>
          <span className="tenant-portal-code-inline">
            <small>Portal code: <strong>{portalCode || 'Not set'}</strong></small>
            {portalCode && <button type="button" className="portal-code-copy" onClick={() => void navigator.clipboard.writeText(portalCode).then(() => { setCopiedPortalCode(portalCode); window.setTimeout(() => setCopiedPortalCode(''), 1800) })}>{copiedPortalCode === portalCode ? <CheckCircle2 size={13} /> : <Copy size={13} />}{copiedPortalCode === portalCode ? 'Copied' : 'Copy'}</button>}
          </span>
          {email && <small>{email}</small>}
        </span>
        <span><strong>{unitLabel}</strong><small>{type} {rent}</small></span>
        <span className="water-bill-cell"><strong>KSh {Number(waterBill).toLocaleString()}</strong><button type="button" className="water-bill-button" onClick={() => onWaterBillUpdate(recordIndex)}><Droplets size={13} /> Update</button><button type="button" className="invoice-button" onClick={() => onGenerateInvoice(recordIndex)}><FileText size={13} /> Invoice</button></span>
        <span className="access-status connected">Active</span>
        <div className="tenant-actions"><button type="button" className="tenant-action-btn view" onClick={() => onViewProfile?.(recordIndex)} title="View profile">👤</button><button type="button" className="tenant-action-btn edit" onClick={() => onEditTenant?.(recordIndex)} title="Edit tenant">✏️</button><button type="button" className="remove-tenant-button" onClick={() => onRemoveTenant(recordIndex)}><UserX size={13} /> Vacate</button></div>
      </div>
    })}
    {rows.length === 0 && <p className="overview-empty">No tenants match your search.</p>}
  </div>
}

function MaintenanceSection({ rows, completedMaintenance, onOpen, onEdit, onDelete, onMarkDone }: { rows: string[]; completedMaintenance: Record<string, boolean>; onOpen: (index: number) => void; onEdit?: (index: number) => void; onDelete?: (index: number) => void; onMarkDone?: (index: number) => void }) {
  return <div className="record-stack">{rows.map((row, index) => { const parts = row.split(' · '); const isNewFormat = parts.length >= 6; const [type, issue, tenant, house, property, priority] = isNewFormat ? parts : ['Maintenance', parts[0], 'Unknown tenant', parts[2] ?? '', parts[1] ?? '', parts[3] ?? '']; const done = Boolean(completedMaintenance[row]) || priority.toLowerCase() === 'done'; const displayPriority = done ? 'Done' : priority; return <div className="maintenance-record-wrapper" key={`${row}-${index}`}><button className={`maintenance-record ${done ? 'maintenance-done' : ''}`} type="button" onClick={() => onOpen(index)}><span className={`priority-dot priority-${done ? 'done' : priority.toLowerCase().includes('high') ? 'high' : priority.toLowerCase().includes('low') ? 'low' : 'medium'}`} /><span><strong>{issue}</strong><small>{type} · {tenant} · {property} · House {house.replace('House ', '')}</small></span><span className="priority-label">{displayPriority || 'Open'}</span><ArrowUpRight size={16} /></button>{(onEdit || onDelete || onMarkDone) && !done && <div className="record-actions">{onMarkDone && <button type="button" className="maintenance-complete-action" onClick={(event) => { event.stopPropagation(); onMarkDone(index) }}><CheckCircle2 size={14} /> Mark as done</button>}{onEdit && <button type="button" className="record-edit-btn" onClick={(event) => { event.stopPropagation(); onEdit(index) }} title="Edit"><span className="record-action-icon">✏️</span><span className="record-action-label">Edit</span></button>}{onDelete && <button type="button" className="record-delete-btn" onClick={(event) => { event.stopPropagation(); onDelete(index) }} title="Delete"><span className="record-action-icon">🗑️</span><span className="record-action-label">Delete</span></button>}</div>}</div> })}</div>
}

function MaintenanceDetailsModal({ row, isDone, onMarkDone, onClose }: { row: string; isDone: boolean; onMarkDone: () => void; onClose: () => void }) {
  const parts = row.split(' · ')
  const isNew = parts.length >= 6
  const issue = isNew ? parts[1] : parts[0]
  const type  = isNew ? parts[0] : 'Maintenance'
  const tenant = isNew ? parts[2] : 'Unknown tenant'
  const house = isNew ? parts[3] : parts[2] ?? ''
  const property = isNew ? parts[4] : parts[1] ?? ''
  const priority = isNew ? parts[5] : parts[3] ?? ''
  const done = isDone
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="maintenance-detail-modal" aria-label="Maintenance details">
      <button type="button" className="modal-close" onClick={onClose} aria-label="Close maintenance details">×</button>
      <p className="eyebrow">Maintenance request</p>
      <h2>{issue}</h2>
      <p className="maintenance-detail-type">{type}</p>
      <div className="maintenance-detail-grid">
        <div><span>Tenant</span><strong>{tenant}</strong></div>
        <div><span>House / unit</span><strong>{house.replace('House ', '')}</strong></div>
        <div><span>Property</span><strong>{property}</strong></div>
        <div><span>Priority</span><strong className={`detail-priority ${done ? 'done' : priority.toLowerCase().includes('high') ? 'high' : priority.toLowerCase().includes('low') ? 'low' : 'medium'}`}>{done ? 'Done' : priority.replace(' priority', '') || 'Open'}</strong></div>
      </div>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={onClose}>Close details</button>{!isDone && <button type="button" className="primary-button maintenance-done-button" onClick={() => { onMarkDone(); onClose() }}><CheckCircle2 size={15} /> Mark as done</button>}</div>
    </section>
  </div>
}

function PaymentSection({ rows, onEdit, onDelete }: { rows: string[]; onEdit?: (index: number) => void; onDelete?: (index: number) => void }) {
  return <div className="record-stack">{rows.map((row, index) => {
    const parts = row.split(' · ')
    const amount = parts[0]
    const tenant = parts[1] ?? ''
    const house = parts.length >= 5 ? parts[2] ?? '' : ''
    const property = parts.length >= 5 ? parts[3] ?? '' : ''
    const date = parts.length >= 5 ? parts[4] ?? '' : parts[2] ?? ''
    const period = parts.length >= 5 ? parts[7] ?? '' : ''
    return <div className="payment-record payment-record-manual" key={`${row}-${index}`}>
      <span className="payment-icon"><CircleDollarSign size={18} /></span>
      <div><strong>{amount}</strong><small>{tenant} · {property}{house ? ` · ${house}` : ''}{period ? ` · ${period}` : ''}</small></div>
      <span className="payment-date payment-date-badge"><CalendarDays size={14} /><span><small>Date paid</small><strong>{date}</strong></span></span>
      <ArrowUpRight size={16} />
      {(onEdit || onDelete) && <div className="record-actions manual-payment-actions">{onEdit && <button type="button" className="record-edit-btn" onClick={(e) => { e.stopPropagation(); onEdit(index) }} title="Edit payment"><span className="record-action-icon">✏️</span><span className="record-action-label">Edit</span></button>}{onDelete && <button type="button" className="record-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(index) }} title="Delete payment"><span className="record-action-icon">🗑️</span><span className="record-action-label">Delete</span></button>}</div>}
    </div>
  })}</div>
}

function ConfirmedRentPaymentSection({ payments }: { payments: RentPaymentRecord[] }) {
  const pageSize = 10
  const [page, setPage] = useState(1)
  const { refresh, refreshing, error } = useContext(ConfirmedRentPaymentRefreshContext)
  const pageCount = Math.max(1, Math.ceil(payments.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visiblePayments = payments.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  return <section className="confirmed-rent-payments">
    <div className="archive-heading">
      <div><p className="eyebrow">M-Pesa Paybill</p><h3>Confirmed rent payments</h3></div>
      <div className="confirmed-rent-payment-actions">
        <span>{payments.length} received</span>
        <button type="button" className="filter-button" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'platform-refresh-spinning' : undefined} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {payments.length ? <div className="record-stack">{visiblePayments.map(payment => <article className="payment-record payment-record-confirmed" key={payment.mpesa_receipt}>
      <span className="payment-icon"><CircleDollarSign size={18} /></span>
      <div><strong>KSh {Number(payment.amount).toLocaleString()}</strong><small>{payment.tenant_name} · {payment.property_name} · Unit {payment.unit_name} · Ref {payment.account_reference}</small></div>
      <span className="payment-date payment-date-badge"><CalendarDays size={14} /><span><small>Date received</small><strong>{new Date(payment.transacted_at).toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })}</strong></span></span>
      <div className="rent-payment-receipt"><small>Transaction reference</small><strong>{payment.mpesa_receipt}</strong></div>
    </article>)}</div> : <p className="overview-empty">No confirmed Paybill rent payments yet.</p>}
    {payments.length > pageSize && <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />}
  </section>
}

function DocumentSection({ rows }: { rows: string[] }) {
  return <div className="record-stack">{rows.map((row, index) => { const [name, property = '', date = ''] = row.split(' · '); return <article className="document-record" key={`${row}-${index}`}><span className="document-icon"><FileText size={18} /></span><div><strong>{name}</strong><small>{property}</small></div><span className="document-date">{date}</span><ArrowUpRight size={16} /></article> })}</div>
}

function DocumentsView({ invoices, legacyRows, canAdd, onAdd, onReopenInvoice }: { invoices: InvoiceRecord[]; legacyRows: string[]; canAdd: boolean; onAdd: () => void; onReopenInvoice?: (invoice: InvoiceRecord) => void }) {
  const pageSize = 10
  const [invoicePage, setInvoicePage] = useState(1)
  const [legacyPage, setLegacyPage] = useState(1)
  const invoicePageCount = Math.max(1, Math.ceil(invoices.length / pageSize))
  const legacyPageCount = Math.max(1, Math.ceil(legacyRows.length / pageSize))
  const currentInvoicePage = Math.min(invoicePage, invoicePageCount)
  const currentLegacyPage = Math.min(legacyPage, legacyPageCount)
  const visibleInvoices = invoices.slice((currentInvoicePage - 1) * pageSize, currentInvoicePage * pageSize)
  const visibleLegacyRows = legacyRows.slice((currentLegacyPage - 1) * pageSize, currentLegacyPage * pageSize)
  return <section className="utility-view panel document-archive-view">
    <div className="section-view-heading"><div><p className="eyebrow">Records</p><h2>Documents</h2><p>Store tenant invoices and important property records in one place.</p></div>{canAdd && <button className="primary-button" onClick={onAdd}><Plus size={17} /> Add document</button>}</div>
    <div className="invoice-archive">
      <div className="archive-heading"><div><p className="eyebrow">Billing archive</p><h3>Tenant invoices</h3></div><span>{invoices.length} generated</span></div>
      {invoices.length ? <div className="invoice-list">{visibleInvoices.map(invoice => <article className="invoice-list-item" key={invoice.id}><span className="invoice-list-icon"><FileText size={18} /></span><div><strong>{invoice.id}</strong><small>{invoice.tenantName} · Unit {invoice.unit} · {invoice.property}</small></div><span className="invoice-list-total">KSh {(Number(invoice.rent.replace(/[^0-9.]/g, '')) + Number(invoice.waterBill.replace(/[^0-9.]/g, ''))).toLocaleString()}<small>{new Date(invoice.issuedAt).toLocaleDateString()}</small></span><button className="invoice-reopen-btn" onClick={() => onReopenInvoice?.(invoice)} title="Reopen invoice"><ArrowUpRight size={14} /> View</button></article>)}</div> : <p className="empty-invoices">Generated tenant invoices will appear here.</p>}
      {invoices.length > pageSize && <Pagination page={currentInvoicePage} pageCount={invoicePageCount} onPageChange={setInvoicePage} />}
    </div>
    <div className="document-archive-legacy">
      <div className="archive-heading"><div><p className="eyebrow">Property records</p><h3>Other documents</h3></div><span>{legacyRows.length} records</span></div>
      <DocumentSection rows={visibleLegacyRows} />
      {legacyRows.length > pageSize && <Pagination page={currentLegacyPage} pageCount={legacyPageCount} onPageChange={setLegacyPage} />}
    </div>
  </section>
}

function InvoiceModal({ tenant, invoice, workspaceName, paymentDetails, onEmailChange, onClose }: { tenant: TenantRecord; invoice: InvoiceRecord; workspaceName: string; paymentDetails: LandlordPaymentDetails; onEmailChange: (email: string) => void; onClose: () => void }) {
  const [shareMessage, setShareMessage] = useState('')
  const [email, setEmail] = useState(tenant.email ?? '')

  const rent = Number(tenant.rent.replace(/[^0-9.]/g, '')) || 0
  const waterBill = Number((tenant.waterBill ?? '0').replace(/[^0-9.]/g, '')) || 0
  const total = rent + waterBill
  const invoiceNumber = invoice.id
  const issuedAt = new Date(invoice.issuedAt)

  const movedInDate = tenant.movedIn ? new Date(`${tenant.movedIn}T00:00:00`) : issuedAt
  const dueDate = getNextMonthlyRentDueDate(tenant.movedIn, issuedAt)
  const dueDateStr = dueDate.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })
  const movedInStr = movedInDate.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })

  const paymentInstructions = buildPaymentInstructionLines(paymentDetails, tenant).join(' · ')
  const shareText = buildRentWhatsAppMessage({ workspaceName, tenant, rent: tenant.rent, waterBill: tenant.waterBill ?? '0', paymentDetails, dueDate: dueDateStr, movedIn: movedInStr, invoiceNumber })

  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
  // Print only the invoice — inject into a hidden iframe, print that, remove it
  const printInvoice = () => {
    const invoiceEl = document.getElementById('printable-invoice')
    if (!invoiceEl) return
    const iframe = document.createElement('iframe')
    iframe.title = `Print invoice ${invoiceNumber}`
    iframe.style.cssText = 'position:fixed;top:0;left:-10000px;width:800px;height:1100px;border:0;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      iframe.remove()
      setShareMessage('Invoice could not be prepared for printing.')
      return
    }
    iframe.onload = () => {
      const printWindow = iframe.contentWindow
      if (!printWindow) {
        iframe.remove()
        return
      }
      printWindow.addEventListener('afterprint', () => iframe.remove(), { once: true })
      window.setTimeout(() => iframe.remove(), 120000)
      printWindow.focus()
      printWindow.print()
    }
    doc.open()
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(invoiceNumber)}</title><style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#0f172a;background:#fff;padding:32px}
      .inv-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:20px;border-bottom:2px solid #0ea5e9;margin-bottom:24px}
      .inv-brand{display:flex;align-items:center;gap:10px}
      .inv-brand-icon{width:38px;height:38px;background:#0f172a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px}
      .inv-brand-name{font-size:15px;font-weight:700;color:#0f172a}
      .inv-brand-sub{font-size:11px;color:#64748b;margin-top:2px}
      .inv-badge{padding:5px 12px;background:#d1fae5;color:#065f46;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase}
      .inv-meta{text-align:right}
      .inv-meta .num{font-size:18px;font-weight:800;color:#0369a1}
      .inv-meta .date{font-size:11px;color:#64748b;margin-top:4px}
      .inv-parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
      .inv-party-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#94a3b8;margin-bottom:6px}
      .inv-party-name{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:3px}
      .inv-party-detail{font-size:12px;color:#475569}
      .inv-due-box{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin-bottom:24px}
      .inv-due-label{font-size:11px;font-weight:700;color:#9a3412;text-transform:uppercase}
      .inv-due-date{font-size:13px;font-weight:700;color:#9a3412}
      .inv-moved-in{font-size:11px;color:#92400e}
      table{width:100%;border-collapse:collapse;margin-bottom:24px}
      thead th{padding:10px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0}
      tbody td{padding:12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a}
      .amount{text-align:right;font-weight:600}
      .total-row td{padding:16px 12px;border-top:3px solid #0ea5e9;font-weight:700;font-size:15px}
      .total-label{color:#0369a1}
      .total-amount{text-align:right;font-size:18px;font-weight:800;color:#0369a1}
      .inv-footer{padding-top:20px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
      .inv-footer-note{font-size:11px;color:#94a3b8;font-style:italic}
      .inv-footer-stamp{font-size:10px;color:#cbd5e1;text-align:right}
      .inv-lines{margin:20px 0 0}
      .inv-line-heading{display:flex;justify-content:space-between;padding:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;border-bottom:1px solid #e2e8f0}
      .inv-lines>div:not(.inv-line-heading){display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #e2e8f0}
      .inv-lines>div>span:first-child{display:flex;flex-direction:column;gap:3px}
      .inv-lines strong{font-size:13px;color:#0f172a}
      .inv-lines small{font-size:11px;color:#64748b}
      .inv-total{margin-top:6px;padding:16px 0 4px!important;border-top:3px solid #0ea5e9!important;border-bottom:0!important}
      .inv-total>span:first-child{display:flex;flex-direction:column;gap:4px}
      .inv-total>span:first-child strong{font-size:24px;color:#0369a1}
      .inv-due-banner{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;margin:20px 0}
      .inv-due-banner>div{display:flex;flex-direction:column;gap:5px}
      .inv-due-eyebrow,.inv-due-label{font-size:10px;font-weight:700;color:#9a3412;text-transform:uppercase}
      .inv-due-date-val{font-size:16px;color:#9a3412}
      .inv-due-banner small{font-size:11px;color:#92400e}
      @page{size:A4;margin:16mm}
      @media print{.invoice-email-field,.share-message,.modal-actions{display:none!important}}
    </style></head><body>
      <div class="inv-header">
        <div class="inv-brand">
          <div class="inv-brand-icon">🏠</div>
          <div><div class="inv-brand-name">${escapeHtml(workspaceName)}</div><div class="inv-brand-sub">Property billing statement</div></div>
        </div>
        <div class="inv-meta">
          <div class="num">${escapeHtml(invoiceNumber)}</div>
          <div class="date">Issued: ${issuedAt.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      </div>
      <div class="inv-parties">
        <div>
          <div class="inv-party-label">Billed to</div>
          <div class="inv-party-name">${escapeHtml(tenant.name)}</div>
          <div class="inv-party-detail">${escapeHtml(tenant.property)}</div>
          <div class="inv-party-detail">Unit ${escapeHtml(tenant.unit)} · ${escapeHtml(tenant.unitType)}</div>
          ${tenant.phone ? '<div class="inv-party-detail">' + escapeHtml(tenant.phone) + '</div>' : ''}
          ${tenant.email ? '<div class="inv-party-detail">' + escapeHtml(tenant.email) + '</div>' : ''}
        </div>
        <div>
          <div class="inv-party-label">From</div>
          <div class="inv-party-name">${escapeHtml(workspaceName)}</div>
        </div>
      </div>
      <div class="inv-due-banner">
        <div>
          <span class="inv-due-eyebrow">Monthly rent due date</span>
          <strong class="inv-due-date-val">${dueDateStr}</strong>
          <small>Tenant assigned on ${movedInStr}</small>
          <small>${escapeHtml(paymentInstructions)}</small>
        </div>
        <span class="inv-due-label">Rent due monthly</span>
      </div>
      <div class="inv-lines">
        <div class="inv-line-heading"><span>Description</span><span>Details</span></div>
        <div>
          <span><strong>House rent</strong><small>Monthly rental charge · ${escapeHtml(tenant.unitType)}</small></span>
          <strong>KSh ${rent.toLocaleString()}</strong>
        </div>
        <div>
          <span><strong>Water bill</strong><small>Monthly water usage charge</small></span>
          <strong>KSh ${waterBill.toLocaleString()}</strong>
        </div>
        <div class="inv-total">
          <span><small>Total amount due</small><strong>KSh ${total.toLocaleString()}</strong></span>
          <span class="inv-due-label">Due ${dueDateStr}</span>
        </div>
      </div>
      <label class="invoice-email-field">
        <span>Email invoice to tenant</span>
        <input type="email" placeholder="tenant@example.com" value="${escapeHtml(email)}" />
      </label>
      <p class="invoice-note">Thank you for your timely payment. Please retain this invoice for your records.</p>
      <p class="share-message">${escapeHtml(shareMessage)}</p>

      <div class="modal-actions">
        <button type="button" class="cancel-button">Close</button>
        <button type="button" class="invoice-print-button">Print / PDF</button>
        <button type="button" class="invoice-email-button">Email tenant</button>
        <button type="button" class="primary-button">Share invoice</button>
      </div>
    </body></html>`)
    doc.close()
  }

  const shareInvoice = () => {
    const phone = normalizeWhatsAppPhone(tenant.phone)
    if (!phone) {
      setShareMessage('No valid registered mobile number. Update the tenant phone number first.')
      return
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(shareText)}`
    window.open(url, '_blank', 'noopener,noreferrer')
    setShareMessage(`WhatsApp opened for ${tenant.name}. Review the invoice and tap Send.`)
  }

  const emailInvoice = () => {
    if (!email.trim()) { setShareMessage('Enter the tenant email address first.'); return }
    onEmailChange(email.trim())
    const subject = `Rent invoice ${invoiceNumber} - ${tenant.property} Unit ${getTenantUnitLabel(tenant)}`
    window.location.href = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareText)}`
  }

  return (
    <div className="modal-backdrop invoice-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="invoice-modal" id="printable-invoice" aria-label="Tenant invoice">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close invoice">×</button>

        <header className="invoice-brand">
          <span className="invoice-brand-mark"><MohaLogo size={18} /></span>
          <div><strong>{workspaceName}</strong><span>Property billing statement</span></div>
          <span className="invoice-status">Amount due</span>
        </header>

        <div className="invoice-title-row">
          <div><p className="eyebrow">Rent and utilities</p><h2>Tenant invoice</h2></div>
          <div className="invoice-meta">
            <span>Invoice number</span>
            <strong>{invoiceNumber}</strong>
            <span>Issued {issuedAt.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>

        <div className="invoice-recipient">
          <div>
            <span className="invoice-label">Billed to</span>
            <strong>{tenant.name}</strong>
            <span>{tenant.property}</span>
            {tenant.phone && <span>{tenant.phone}</span>}
            {tenant.email && <span>{tenant.email}</span>}
          </div>
          <div>
            <span className="invoice-label">Unit</span>
            <strong>{getTenantUnitLabel(tenant)}</strong>
            <span>{tenant.unitType}</span>
          </div>
        </div>

        {/* Due date banner */}
        <div className="invoice-due-banner">
          <div>
            <span className="invoice-due-eyebrow">Monthly rent due date</span>
            <strong className="invoice-due-date-val">{dueDateStr}</strong>
            <small>Tenant assigned on {movedInStr}</small>
            <small>{paymentInstructions}</small>
          </div>
          <span className="invoice-due-label">Rent due monthly</span>
        </div>

        <div className="invoice-lines">
          <div className="invoice-line-heading"><span>Description</span><span>Amount</span></div>
          <div>
            <span><strong>House rent</strong><small>Monthly rental charge · {tenant.unitType}</small></span>
            <strong>KSh {rent.toLocaleString()}</strong>
          </div>
          <div>
            <span><strong>Water bill</strong><small>Monthly water usage charge</small></span>
            <strong>KSh {waterBill.toLocaleString()}</strong>
          </div>
          <div className="invoice-total">
            <span><small>Total amount due</small><strong>KSh {total.toLocaleString()}</strong></span>
            <span className="invoice-due-label">Due {dueDateStr}</span>
          </div>
        </div>

        <label className="invoice-email-field">
          <span>Email invoice to tenant</span>
          <input type="email" placeholder="tenant@example.com" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <p className="invoice-note">Thank you for your timely payment. Please retain this invoice for your records.</p>
        {shareMessage && <p className="share-message">{shareMessage}</p>}

        <div className="modal-actions">
          <button type="button" className="cancel-button" onClick={onClose}>Close</button>
          <button type="button" className="invoice-print-button" onClick={printInvoice}><FileText size={15} /> Print / PDF</button>
          <button type="button" className="invoice-email-button" onClick={emailInvoice}>Email tenant</button>
          <button type="button" className="primary-button" onClick={shareInvoice}><ArrowUpRight size={15} /> WhatsApp tenant</button>
        </div>
      </section>
    </div>
  )
}

function PropertyUnitsView({ propertyName, property, units, tenants, payments, maintenance, completedMaintenance, onBack, onRenameUnit }: {
  propertyName: string
  property: PropertyRecord
  units: UnitRecord[]
  tenants: TenantRecord[]
  payments: string[]
  maintenance: string[]
  completedMaintenance: Record<string, boolean>
  onBack: () => void
  onRenameUnit?: (unitId: string, displayName: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'units' | 'tenants' | 'payments' | 'maintenance'>('overview')
  const [page, setPage] = useState(1)
  const [renamingUnit, setRenamingUnit] = useState<string | null>(null)
  const [unitNameDraft, setUnitNameDraft] = useState('')
  const [unitNameError, setUnitNameError] = useState('')
  const pageSize = 12

  const occupiedUnits = units.filter(u => u.status === 'Occupied').length
  const vacantUnits = units.length - occupiedUnits
  const occupancyRate = units.length ? Math.round(occupiedUnits / units.length * 100) : 0
  const totalIncome = Number(property?.income?.replace(/[^0-9.]/g, '') || 0)
  const collectedIncome = payments.reduce((sum, row) => sum + (Number(row.split(' · ')[0].replace(/[^0-9.]/g, '')) || 0), 0)
  const openMaintenanceCount = maintenance.filter(r => !completedMaintenance[r]).length
  const doneMaintenanceCount = maintenance.length - openMaintenanceCount
  const collectionRate = totalIncome ? Math.min(Math.round(collectedIncome / totalIncome * 100), 100) : 0

  const leaseCutoff = new Date()
  leaseCutoff.setDate(leaseCutoff.getDate() + 60)
  const expiringLeases = tenants.filter(t => t.leaseEnd && new Date(`${t.leaseEnd}T00:00:00`) <= leaseCutoff)

  const tabs: { key: typeof activeTab; label: string; count?: number }[] = [
    { key: 'overview',     label: 'Overview' },
    { key: 'units',        label: 'Units',       count: units.length },
    { key: 'tenants',      label: 'Tenants',     count: tenants.length },
    { key: 'payments',     label: 'Payments',    count: payments.length },
    { key: 'maintenance',  label: 'Maintenance', count: maintenance.length },
  ]
  const activeListCount = activeTab === 'units' ? units.length : activeTab === 'tenants' ? tenants.length : activeTab === 'payments' ? payments.length : activeTab === 'maintenance' ? maintenance.length : 0
  const pageCount = Math.max(1, Math.ceil(activeListCount / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const visibleUnits = units.slice(pageStart, pageStart + pageSize)
  const visibleTenants = tenants.slice(pageStart, pageStart + pageSize)
  const visiblePayments = payments.slice(pageStart, pageStart + pageSize)
  const visibleMaintenance = maintenance.slice(pageStart, pageStart + pageSize)

  return (
    <section className="property-overview">
      {/* Back */}
      <button className="back-link" onClick={onBack}><ArrowUpRight size={15} className="back-icon" /> Back to properties</button>

      {/* Hero header */}
      <div className="po-hero">
        <div className="po-hero-icon"><Building2 size={28} /></div>
        <div className="po-hero-info">
          <p className="eyebrow">Property overview</p>
          <h2>{propertyName}</h2>
          <p className="po-address">{property?.address}</p>
        </div>
        <div className="po-hero-badges">
          <span className={`status ${property?.status?.toLowerCase()}`}>{property?.status}</span>
          <span className="po-income-badge">KSh {totalIncome.toLocaleString()} / month</span>
        </div>
      </div>

      {/* Metric strip */}
      <div className="po-metrics">
        <div className="po-metric">
          <span className="po-metric-icon blue"><Building2 size={18} /></span>
          <div>
            <strong>{units.length}</strong>
            <small>Total units</small>
          </div>
        </div>
        <div className="po-metric">
          <span className="po-metric-icon green"><Users size={18} /></span>
          <div>
            <strong>{occupiedUnits}</strong>
            <small>Occupied</small>
          </div>
        </div>
        <div className="po-metric">
          <span className="po-metric-icon orange"><Home size={18} /></span>
          <div>
            <strong>{vacantUnits}</strong>
            <small>Vacant</small>
          </div>
        </div>
        <div className="po-metric">
          <span className="po-metric-icon purple"><CircleDollarSign size={18} /></span>
          <div>
            <strong>KSh {collectedIncome.toLocaleString()}</strong>
            <small>Collected</small>
          </div>
        </div>
        <div className="po-metric">
          <span className="po-metric-icon teal"><TrendingUp size={18} /></span>
          <div>
            <strong>{occupancyRate}%</strong>
            <small>Occupancy</small>
          </div>
        </div>
        <div className="po-metric">
          <span className="po-metric-icon red"><Wrench size={18} /></span>
          <div>
            <strong>{openMaintenanceCount}</strong>
            <small>Open issues</small>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="po-tabs">
        {tabs.map(tab => (
                    <button 
            key={tab.key}
            className={`po-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.key); setPage(1) }}
          >
            {tab.label}
            {tab.count !== undefined && <span className="po-tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="po-tab-content">

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div className="po-overview-grid">
            {/* Collection progress */}
            <div className="po-card">
              <div className="po-card-heading">
                <div><p className="eyebrow">Finance</p><h3>Rent collection</h3></div>
                <span className="po-metric-icon green"><CircleDollarSign size={18} /></span>
              </div>
              <div className="po-collection-bar-wrap">
                <div className="po-collection-bar">
                  <div className="po-collection-fill" style={{ width: `${collectionRate}%` }} />
                </div>
                <span className="po-collection-pct">{collectionRate}% collected</span>
              </div>
              <div className="po-collection-nums">
                <div><small>Total rent roll</small><strong>KSh {totalIncome.toLocaleString()}</strong></div>
                <div><small>Collected</small><strong style={{ color: '#059669' }}>KSh {collectedIncome.toLocaleString()}</strong></div>
                <div><small>Outstanding</small><strong style={{ color: '#dc2626' }}>KSh {Math.max(totalIncome - collectedIncome, 0).toLocaleString()}</strong></div>
              </div>
            </div>

            {/* Occupancy breakdown */}
            <div className="po-card">
              <div className="po-card-heading">
                <div><p className="eyebrow">Occupancy</p><h3>Unit breakdown</h3></div>
                <span className="po-metric-icon blue"><Building2 size={18} /></span>
              </div>
              <div className="po-donut-wrap">
                <svg viewBox="0 0 36 36" className="po-donut">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e2e8f0" strokeWidth="3.2" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#10b981" strokeWidth="3.2"
                    strokeDasharray={`${occupancyRate} ${100 - occupancyRate}`}
                    strokeDashoffset="25" strokeLinecap="round" />
                  <text x="18" y="20.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">{occupancyRate}%</text>
                </svg>
                <div className="po-donut-legend">
                  <div><span className="po-legend-dot green" /><span>Occupied — {occupiedUnits}</span></div>
                  <div><span className="po-legend-dot gray" /><span>Vacant — {vacantUnits}</span></div>
                </div>
              </div>
            </div>

            {/* Maintenance summary */}
            <div className="po-card">
              <div className="po-card-heading">
                <div><p className="eyebrow">Maintenance</p><h3>Request status</h3></div>
                <span className="po-metric-icon red"><Wrench size={18} /></span>
              </div>
              <div className="po-maint-summary">
                <div className="po-maint-stat open"><strong>{openMaintenanceCount}</strong><small>Open requests</small></div>
                <div className="po-maint-stat done"><strong>{doneMaintenanceCount}</strong><small>Completed</small></div>
              </div>
              {maintenance.slice(0, 3).map(row => {
                const parts = row.split(' · ')
                const issue = parts.length >= 6 ? parts[1] : parts[0]
                const priority = parts.length >= 6 ? parts[5] : parts[3] ?? ''
                const done = completedMaintenance[row]
                return (
                  <div key={row} className="po-maint-row">
                    <span className={`priority-dot priority-${done ? 'done' : priority.toLowerCase().includes('high') ? 'high' : priority.toLowerCase().includes('low') ? 'low' : 'medium'}`} />
                    <span>{issue}</span>
                    <span className="po-maint-prio">{done ? 'Done' : priority.replace(' priority', '') || 'Open'}</span>
                  </div>
                )
              })}
              {maintenance.length === 0 && <p className="overview-empty">No maintenance requests for this property.</p>}
            </div>

            {/* Expiring leases */}
            <div className="po-card">
              <div className="po-card-heading">
                <div><p className="eyebrow">Leases</p><h3>Expiring soon</h3></div>
                <span className="po-metric-icon orange"><CalendarDays size={18} /></span>
              </div>
              {expiringLeases.length ? expiringLeases.slice(0, 3).map(t => (
                <div key={t.unit} className="po-lease-row">
                  <span className="user-avatar" style={{ width: 30, height: 30, fontSize: 10 }}>{t.name.slice(0, 2).toUpperCase()}</span>
                  <div><strong>{t.name}</strong><small>Unit {getTenantUnitLabel(t)}</small></div>
                  <span className="po-lease-date">{new Date(`${t.leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
              )) : <p className="overview-empty">No leases expiring in the next 60 days.</p>}
            </div>

            {/* Recent payments */}
            <div className="po-card po-card-wide">
              <div className="po-card-heading">
                <div><p className="eyebrow">Recent activity</p><h3>Latest payments</h3></div>
                <span className="po-metric-icon purple"><CircleDollarSign size={18} /></span>
              </div>
              {payments.length ? payments.slice(0, 5).map(row => {
                const parts = row.split(' · ')
                const [amount, tenant = '', house] = parts
                return (
                  <div key={row} className="po-payment-row">
                    <span className="payment-icon" style={{ width: 34, height: 34 }}><CircleDollarSign size={16} /></span>
                    <div><strong>{amount}</strong><small>{tenant} · {house}</small></div>
                    <span className="payment-date">{parts[4] ?? ''}</span>
                  </div>
                )
              }) : <p className="overview-empty">No payments recorded for this property yet.</p>}
            </div>
          </div>
        )}

        {/* ── UNITS TAB ── */}
        {activeTab === 'units' && (
          <div>
            <div className="unit-grid">
              {visibleUnits.map(unit => (
                <article className="unit-card" key={unit.unit}>
                  {renamingUnit === unit.unit ? <form className="unit-name-editor" onSubmit={event => {
                    event.preventDefault()
                    const displayName = unitNameDraft.trim()
                    if (!displayName) { setUnitNameError('Enter a name for this unit.'); return }
                    if (units.some(other => other.unit !== unit.unit && (other.displayName || other.unit).trim().toLocaleLowerCase() === displayName.toLocaleLowerCase())) {
                      setUnitNameError('Another unit already uses that name in this property.')
                      return
                    }
                    onRenameUnit?.(unit.unit, displayName === unit.unit ? '' : displayName)
                    setRenamingUnit(null)
                    setUnitNameError('')
                  }}>
                    <label><span>Unit name</span><input autoFocus maxLength={60} value={unitNameDraft} onChange={event => { setUnitNameDraft(event.target.value); setUnitNameError('') }} /></label>
                    {unitNameError && <small className="unit-name-error" role="alert">{unitNameError}</small>}
                    <div><button type="submit" className="unit-name-save">Save name</button><button type="button" className="unit-name-cancel" onClick={() => { setRenamingUnit(null); setUnitNameError('') }}>Cancel</button></div>
                  </form> : <div className="unit-card-top">
                    <strong>{unit.displayName || unit.unit}</strong>
                    <div className="unit-card-actions"><span className={`status ${unit.status.toLowerCase()}`}>{unit.status}</span>{onRenameUnit && <button type="button" aria-label={`Edit name for ${unit.displayName || unit.unit}`} title="Edit unit name" onClick={() => { setRenamingUnit(unit.unit); setUnitNameDraft(unit.displayName || unit.unit); setUnitNameError('') }}><Pencil size={14} /></button>}</div>
                  </div>}
                  <p className="unit-type">{unit.type}</p>
                  <p className="unit-tenant">{unit.tenant}</p>
                  <div className="unit-card-bottom"><span>Monthly rent</span><strong>{unit.rent}</strong></div>
                </article>
              ))}
            </div>
            {units.length === 0 && <p className="overview-empty" style={{ padding: '40px 0' }}>No units found for this property.</p>}
          </div>
        )}

        {/* ── TENANTS TAB ── */}
        {activeTab === 'tenants' && (
          <div className="po-tenants-list">
            {tenants.length ? visibleTenants.map(t => (
              <div key={t.unit} className="po-tenant-row">
                <span className="user-avatar">{t.name.slice(0, 2).toUpperCase()}</span>
                <div className="po-tenant-info">
                  <strong>{t.name}</strong>
                  <small>{t.unitDisplayName || t.unit} · {t.unitType}</small>
                </div>
                <div className="po-tenant-meta">
                  <span><strong>KSh {Number(t.rent.replace(/[^0-9.]/g, '')).toLocaleString()}</strong><small>Rent</small></span>
                  <span><strong>KSh {Number(t.waterBill ?? '0').toLocaleString()}</strong><small>Water</small></span>
                  <span><strong>{t.leaseEnd ? new Date(`${t.leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric' }) : '—'}</strong><small>Lease end</small></span>
                </div>
                <span className="access-status connected">Active</span>
              </div>
            )) : <p className="overview-empty" style={{ padding: '40px 0' }}>No tenants assigned to this property yet.</p>}
          </div>
        )}

        {/* ── PAYMENTS TAB ── */}
        {activeTab === 'payments' && (
          <div className="record-stack">
            {payments.length ? visiblePayments.map((row, i) => {
              const parts = row.split(' · ')
              const [amount, tenant = '', house = '', , date = ''] = parts
              return (
                <article className="payment-record" key={`${row}-${i}`}>
                  <span className="payment-icon"><CircleDollarSign size={18} /></span>
                  <div><strong>{amount}</strong><small>{tenant} · {house}</small></div>
                  <span className="payment-date">{date}</span>
                </article>
              )
            }) : <p className="overview-empty" style={{ padding: '40px 0' }}>No payments recorded for this property.</p>}
          </div>
        )}

        {/* ── MAINTENANCE TAB ── */}
        {activeTab === 'maintenance' && (
          <div className="record-stack">
            {maintenance.length ? visibleMaintenance.map((row, i) => {
              const parts = row.split(' · ')
              const isNew = parts.length >= 6
              const issue = isNew ? parts[1] : parts[0]
              const type  = isNew ? parts[0] : 'Maintenance'
              const house = isNew ? parts[3] : parts[2] ?? ''
              const priority = isNew ? parts[5] : parts[3] ?? ''
              const done = completedMaintenance[row]
              return (
                <div className={`maintenance-record ${done ? 'maintenance-done' : ''}`} key={`${row}-${i}`}>
                  <span className={`priority-dot priority-${done ? 'done' : priority.toLowerCase().includes('high') ? 'high' : priority.toLowerCase().includes('low') ? 'low' : 'medium'}`} />
                  <span style={{ flex: 1 }}>
                    <strong>{issue}</strong>
                    <small style={{ display: 'block', fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>{type} · House {house.replace('House ', '')}</small>
                  </span>
                  <span className="priority-label">{done ? 'Done' : priority.replace(' priority', '') || 'Open'}</span>
                </div>
              )
            }) : <p className="overview-empty" style={{ padding: '40px 0' }}>No maintenance requests for this property.</p>}
          </div>
        )}
        {activeListCount > pageSize && <Pagination page={currentPage} pageCount={pageCount} onPageChange={setPage} />}
      </div>
    </section>
  )
}

// Default roles per user type
const defaultRoleForType: Record<AccessUser['userType'], AccessUser['role']> = {
  'Platform Administrator': 'Administrator',
  'Landlord': 'Administrator',
  'Property Manager': 'Manager',
  'Caretaker': 'Caretaker',
}

function TenantPortalView({ tenants, workspaceName, propertyGroup, paymentRows, directRentPayments }: { tenants: TenantRecord[]; workspaceName: string; propertyGroup: string; paymentRows: string[]; directRentPayments: RentPaymentRecord[] }) {
  const [selectedTenantKey, setSelectedTenantKey] = useState(tenants[0] ? `${tenants[0].name}::${tenants[0].property}::${tenants[0].unit}` : '')
  const [tenantPage, setTenantPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [serviceRequestPage, setServiceRequestPage] = useState(1)
  const pageSize = 12
  const selectedTenant = tenants.find(tenant => `${tenant.name}::${tenant.property}::${tenant.unit}` === selectedTenantKey) ?? tenants[0] ?? null

  const getDueDate = (tenant: TenantRecord) => {
    return getNextMonthlyRentDueDate(tenant.movedIn)
  }

  const buildStatement = () => {
    if (!selectedTenant) return { due: 0, paid: 0, balance: 0, history: [] as Array<{ label: string; amount: number; date: string; method: string }>, reminders: [] as Array<{ label: string; dueLabel: string }> }
    const asNumber = (value: string) => Number(String(value).replace(/[^0-9.]/g, '')) || 0
    const directMatches = directRentPayments.filter(payment => payment.property_name === selectedTenant.property && payment.unit_name === selectedTenant.unit)
    const manualMatches = paymentRows.filter(row => {
      const parts = row.split(' · ')
      const rowProperty = parts[3] ?? ''
      const rowUnit = parts[2]?.replace('House ', '') ?? ''
      return rowProperty === selectedTenant.property && (rowUnit === selectedTenant.unit || row.includes(selectedTenant.unit))
    })
    const history = [
      ...manualMatches.map((row) => {
        const parts = row.split(' · ')
        return { label: parts[6] || 'Manual payment', amount: asNumber(parts[0]), date: parts[4] || new Date().toISOString().slice(0, 10), method: parts[5] || 'Manual' }
      }),
      ...directMatches.map(payment => ({ label: payment.mpesa_receipt || 'M-Pesa payment', amount: Number(payment.amount || 0), date: new Date(payment.transacted_at).toISOString().slice(0, 10), method: 'M-Pesa' })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const paidTotal = history.reduce((sum, item) => sum + item.amount, 0)
    const dueTotal = Number(selectedTenant.rent.replace(/[^0-9.]/g, '')) || 0
    const balance = Math.max(dueTotal - paidTotal, 0)
    const nextDue = getDueDate(selectedTenant)
    const reminders = [
      { label: 'Rent due', dueLabel: nextDue.toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' }) },
      { label: 'Payment reminder', dueLabel: balance > 0 ? 'Outstanding balance: KSh ' + balance.toLocaleString() : 'Paid in full' },
    ]
    return { due: dueTotal, paid: paidTotal, balance, history, reminders }
  }

  const statement = buildStatement()
  const tenantPageCount = Math.max(1, Math.ceil(tenants.length / pageSize))
  const currentTenantPage = Math.min(tenantPage, tenantPageCount)
  const visibleTenants = tenants.slice((currentTenantPage - 1) * pageSize, currentTenantPage * pageSize)
  const historyPageCount = Math.max(1, Math.ceil(statement.history.length / pageSize))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const visibleHistory = statement.history.slice((currentHistoryPage - 1) * pageSize, currentHistoryPage * pageSize)
  const tenantServiceRequests = paymentRows.filter(row => row.includes(selectedTenant?.property ?? '') && row.includes(selectedTenant?.unit ?? ''))
  const serviceRequestPageCount = Math.max(1, Math.ceil(tenantServiceRequests.length / pageSize))
  const visibleServiceRequests = tenantServiceRequests.slice((Math.min(serviceRequestPage, serviceRequestPageCount) - 1) * pageSize, Math.min(serviceRequestPage, serviceRequestPageCount) * pageSize)

  return <section className="utility-view panel"><div className="utility-heading"><div><p className="eyebrow">Tenant experience</p><h2>Tenant portal</h2><p>Statement overview, reminders, payment history, and support for each tenant.</p></div></div>
    <div className="portfolio-health panel" style={{ marginBottom: 18 }}>
      <div className="panel-heading"><div><p className="eyebrow">Statement</p><h2>{workspaceName}</h2></div><span className="live-badge">{propertyGroup}</span></div>
      <div className="health-grid">
        <article><span className="health-icon collection"><CircleDollarSign size={18} /></span><div><strong>KSh {statement.due.toLocaleString()}</strong><small>Current rent due</small></div></article>
        <article><span className="health-icon vacancy"><FileText size={18} /></span><div><strong>KSh {statement.paid.toLocaleString()}</strong><small>Total paid</small></div></article>
        <article><span className="health-icon lease"><Bell size={18} /></span><div><strong>{statement.balance > 0 ? `KSh ${statement.balance.toLocaleString()}` : 'Paid in full'}</strong><small>Outstanding balance</small></div></article>
      </div>
    </div>

    <div className="dashboard-grid tenant-experience-grid">
      <article className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Residents</p><h2>My unit</h2></div></div>
        <div className="user-list">
          {visibleTenants.map((tenant) => {
            const key = `${tenant.name}::${tenant.property}::${tenant.unit}`
            return <button key={key} type="button" className={`user-row ${selectedTenantKey === key ? 'selected' : ''}`} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => { setSelectedTenantKey(key); setHistoryPage(1) }}>
              <span className="user-avatar">{tenant.name.slice(0, 2).toUpperCase()}</span>
              <div style={{ flex: 1 }}>
                <strong>{tenant.name}</strong>
                <small>{tenant.property} · Unit {getTenantUnitLabel(tenant)}</small>
              </div>
              <span className={`access-status ${statement.balance > 0 ? 'disconnected' : 'connected'}`}>{statement.balance > 0 ? 'Due' : 'Clear'}</span>
            </button>
          })}
        </div>
        {tenants.length > pageSize && <Pagination page={currentTenantPage} pageCount={tenantPageCount} onPageChange={setTenantPage} />}
      </article>

      {selectedTenant && <article className="panel">
        <div className="panel-heading"><div><p className="eyebrow">Resident profile</p><h2>{selectedTenant.name}</h2></div><span className="live-badge">{selectedTenant.property}</span></div>
        <div className="due-list" style={{ marginTop: 12 }}>
          <div><span><strong>{getTenantUnitLabel(selectedTenant)}</strong><small>Unit</small></span><span className="payment-state paid">{selectedTenant.status}</span></div>
          <div><span><strong>KSh {Number(selectedTenant.rent.replace(/[^0-9.]/g, '')).toLocaleString()}</strong><small>Rent due</small></span><span className="payment-state due">{getDueDate(selectedTenant).toLocaleDateString('en-KE', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
        </div>
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Reminders</h3>
          <div className="mini-ledger">
            {statement.reminders.map((reminder) => <div key={reminder.label}><span><strong>{reminder.label}</strong><small>{reminder.dueLabel}</small></span><button type="button" className="reminder-button" onClick={() => window.open(`https://wa.me/${(selectedTenant.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${selectedTenant.name}, ${reminder.label} for ${selectedTenant.property}, Unit ${getTenantUnitLabel(selectedTenant)}. Please settle your balance with the property office.`)}`, '_blank', 'noopener,noreferrer')}>WhatsApp</button></div>)}
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Payment history</h3>
          <div className="mini-ledger">
            {statement.history.length ? visibleHistory.map((payment, index) => <div key={`${payment.date}-${payment.label}-${index}`}><span><strong>KSh {payment.amount.toLocaleString()}</strong><small>{payment.method} · {payment.date}</small></span><span className="payment-state paid">{payment.label}</span></div>) : <p className="overview-empty">No payment history yet.</p>}
          </div>
          {statement.history.length > pageSize && <Pagination page={currentHistoryPage} pageCount={historyPageCount} onPageChange={setHistoryPage} />}
        </div>
        <div style={{ marginTop: 20 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Service requests</h3>
          <div className="mini-ledger">
            {tenantServiceRequests.length ? visibleServiceRequests.map((row, index) => <div key={`${row}-${index}`}><span><strong>{row.split(' · ')[1] || 'Service request'}</strong><small>{selectedTenant.property} · {getTenantUnitLabel(selectedTenant)}</small></span><span className="payment-state paid">Open</span></div>) : <p className="overview-empty">No service issues logged.</p>}
          </div>
          {tenantServiceRequests.length > pageSize && <Pagination page={Math.min(serviceRequestPage, serviceRequestPageCount)} pageCount={serviceRequestPageCount} onPageChange={setServiceRequestPage} />}
        </div>
      </article>}
    </div>
  </section>
}

// Allowed roles per user type
const rolesForType: Record<AccessUser['userType'], AccessUser['role'][]> = {
  'Platform Administrator': ['Administrator'],
  'Landlord': ['Administrator'],
  'Property Manager': ['Manager', 'Accountant', 'Viewer'],
  'Caretaker': ['Caretaker'],
}

const userTypeConfig: Record<AccessUser['userType'], { icon: string; color: string; description: string }> = {
  'Platform Administrator': { icon: '🛡️', color: 'ut-landlord', description: 'Oversees landlord accounts and platform operations.' },
  'Landlord':         { icon: '🏠', color: 'ut-landlord',  description: 'Owns the properties. Full or high-level access.' },
  'Property Manager': { icon: '💼', color: 'ut-manager',   description: 'Manages day-to-day operations on behalf of the landlord.' },
  'Caretaker':        { icon: '🔧', color: 'ut-caretaker', description: 'Handles maintenance, unit checks, and on-site tasks.' },
}

function SettingsView({
  sessionUser, users, workspaceName, propertyGroup, landlordPaybill, landlordPaymentMethod, landlordTillNumber, landlordBankName, landlordBankAccountName, landlordBankAccountNumber,
  notifEmail, notifWeekly, rentReminderEnabled, rentReminderDays, rentReminderChannel,
  onSaveWorkspace, onSaveSubscriptionPaymentDetails, onToggleNotifEmail, onToggleNotifWeekly, onToggleRentReminder, onChangeRentReminderDays, onChangeRentReminderChannel, onRegisterRentPaybillCallbacks,
  onCreateUser, onUpdateUser, onDeleteUser, onDisconnect, onReconnect, onReviewSubscriptionPayment, onLoadSubscriptionPaymentHistory, onApproveLandlordSignup, onRejectLandlordSignup, onResetPassword
}: {
  sessionUser: AccessUser
  users: AccessUser[]
  workspaceName: string
  propertyGroup: string
  landlordPaybill: string
  landlordPaymentMethod: LandlordPaymentMethod
  landlordTillNumber: string
  landlordBankName: string
  landlordBankAccountName: string
  landlordBankAccountNumber: string
  notifEmail: boolean
  notifWeekly: boolean
  rentReminderEnabled: boolean
  rentReminderDays: number
  rentReminderChannel: RentReminderChannel
  onSaveWorkspace: (name: string, group: string, paymentDetails: LandlordPaymentDetails) => void
  onSaveSubscriptionPaymentDetails: (details: SubscriptionPaymentDetails) => void
  onToggleNotifEmail: () => void
  onToggleNotifWeekly: () => void
  onToggleRentReminder: () => void
  onChangeRentReminderDays: (value: number) => void
  onChangeRentReminderChannel: (value: RentReminderChannel) => void
  onRegisterRentPaybillCallbacks: () => Promise<void>
  onCreateUser: (user: AccessUser) => Promise<void>
  onUpdateUser: (user: AccessUser, original: AccessUser) => Promise<void>
  onDeleteUser: (id: string) => Promise<void>
  onDisconnect: (id: string) => Promise<void>
  onReconnect: (id: string) => Promise<void>
  onReviewSubscriptionPayment: (requestId: string, approve: boolean) => Promise<void>
  onLoadSubscriptionPaymentHistory: (status: SubscriptionPaymentHistoryFilter, page: number, pageSize: number) => Promise<AdminSubscriptionPaymentHistoryResult>
  onApproveLandlordSignup: (userId: string) => Promise<void>
  onRejectLandlordSignup: (userId: string) => Promise<void>
  onResetPassword: (email: string) => Promise<void>
}) {
  const isPlatformAdmin = sessionUser.userType === 'Platform Administrator' && sessionUser.role === 'Administrator'
  const canManageTeam = sessionUser.role === 'Administrator' && (isPlatformAdmin || sessionUser.userType === 'Landlord')
  const inviteTypes: AccessUser['userType'][] = isPlatformAdmin ? ['Landlord'] : sessionUser.userType === 'Landlord' ? ['Caretaker'] : []

  // Workspace
  const [wsName, setWsName] = useState(workspaceName)
  const [wsPropGroup, setWsPropGroup] = useState(propertyGroup)
  const [wsLandlordPaybill, setWsLandlordPaybill] = useState(landlordPaybill)
  const [wsPaymentMethod, setWsPaymentMethod] = useState<LandlordPaymentMethod>(landlordPaymentMethod)
  const [wsLandlordTillNumber, setWsLandlordTillNumber] = useState(landlordTillNumber)
  const [wsLandlordBankName, setWsLandlordBankName] = useState(landlordBankName)
  const [wsLandlordBankAccountName, setWsLandlordBankAccountName] = useState(landlordBankAccountName)
  const [wsLandlordBankAccountNumber, setWsLandlordBankAccountNumber] = useState(landlordBankAccountNumber)
  const [wsSaved, setWsSaved] = useState(false)

  useEffect(() => {
    setWsName(workspaceName)
    setWsPropGroup(propertyGroup)
    setWsLandlordPaybill(landlordPaybill)
    setWsPaymentMethod(landlordPaymentMethod)
    setWsLandlordTillNumber(landlordTillNumber)
    setWsLandlordBankName(landlordBankName)
    setWsLandlordBankAccountName(landlordBankAccountName)
    setWsLandlordBankAccountNumber(landlordBankAccountNumber)
  }, [workspaceName, propertyGroup, landlordPaybill, landlordPaymentMethod, landlordTillNumber, landlordBankName, landlordBankAccountName, landlordBankAccountNumber])

  // New user — step 1: pick type, step 2: fill details
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [newUserType, setNewUserType] = useState<AccessUser['userType']>('Landlord')
  const [newUser, setNewUser] = useState<{ name: string; email: string; phone: string; role: AccessUser['role'] }>({ name: '', email: '', phone: '', role: 'Administrator' })
  const [createError, setCreateError] = useState('')
  const [signupActionId, setSignupActionId] = useState<string | null>(null)

  // Edit / reset
  const [editingUser, setEditingUser] = useState<AccessUser | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ name: string; username: string; email: string; phone: string; userType: AccessUser['userType']; role: AccessUser['role'] }>({ name: '', username: '', email: '', phone: '', userType: 'Landlord', role: 'Administrator' })
  const [resetTarget, setResetTarget] = useState<AccessUser | null>(null)
  const [resetMessage, setResetMessage] = useState('')
  const [paybillSetupMessage, setPaybillSetupMessage] = useState('')
  const [registeringPaybill, setRegisteringPaybill] = useState(false)
  const [paymentActionId, setPaymentActionId] = useState<string | null>(null)
  const [paymentActionError, setPaymentActionError] = useState('')
  const [paymentActionMessage, setPaymentActionMessage] = useState('')
  const [filterType, setFilterType] = useState<AccessUser['userType'] | 'All'>('All')
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSection>(isPlatformAdmin ? 'subscription-payments' : sessionUser.userType === 'Landlord' && sessionUser.role === 'Administrator' ? 'rent-collection' : 'workspace')
  const [teamPage, setTeamPage] = useState(1)
  const [subscriptionPage, setSubscriptionPage] = useState(1)
  const [subscriptionHistoryFilter, setSubscriptionHistoryFilter] = useState<SubscriptionPaymentHistoryFilter | null>(null)
  const [subscriptionHistoryPage, setSubscriptionHistoryPage] = useState(1)
  const [subscriptionHistoryRows, setSubscriptionHistoryRows] = useState<AdminSubscriptionPaymentHistoryRow[]>([])
  const [subscriptionHistoryTotal, setSubscriptionHistoryTotal] = useState(0)
  const [subscriptionHistoryLoading, setSubscriptionHistoryLoading] = useState(false)
  const [subscriptionHistoryError, setSubscriptionHistoryError] = useState('')
  const [subscriptionHistoryRefresh, setSubscriptionHistoryRefresh] = useState(0)

  useEffect(() => {
    if (!isPlatformAdmin || !subscriptionHistoryFilter) return
    let active = true
    onLoadSubscriptionPaymentHistory(subscriptionHistoryFilter, subscriptionHistoryPage, 10)
      .then(result => {
        if (!active) return
        setSubscriptionHistoryRows(result.requests)
        setSubscriptionHistoryTotal(result.total_count)
      })
      .catch(error => {
        if (!active) return
        setSubscriptionHistoryRows([])
        setSubscriptionHistoryTotal(0)
        setSubscriptionHistoryError(error instanceof Error ? error.message : 'Could not load payment history.')
      })
      .finally(() => {
        if (active) setSubscriptionHistoryLoading(false)
      })
    return () => { active = false }
  }, [isPlatformAdmin, onLoadSubscriptionPaymentHistory, subscriptionHistoryFilter, subscriptionHistoryPage, subscriptionHistoryRefresh])

  const saveWorkspace = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSaveWorkspace(isPlatformAdmin ? wsName : workspaceName, wsPropGroup, {
      method: wsPaymentMethod,
      paybillNumber: wsLandlordPaybill,
      tillNumber: wsLandlordTillNumber,
      bankName: wsLandlordBankName,
      bankAccountName: wsLandlordBankAccountName,
      bankAccountNumber: wsLandlordBankAccountNumber,
    })
    setWsSaved(true)
    setTimeout(() => setWsSaved(false), 2500)
  }

  const goToStep2 = (type: AccessUser['userType']) => {
    setNewUserType(type)
    setNewUser({ name: '', email: '', phone: '', role: defaultRoleForType[type] })
    setCreateError('')
    setCreateStep(2)
  }

  const createUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreateError('')
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const sendWhatsApp = isPlatformAdmin && newUserType === 'Landlord' && submitter?.value === 'add-and-whatsapp'
    const whatsappWindow = sendWhatsApp ? window.open('about:blank', '_blank') : null
    const email = newUser.email.trim().toLowerCase()
    if (users.some(user => user.email?.toLowerCase() === email)) {
      whatsappWindow?.close()
      setCreateError(`An account for ${email} is already listed.`)
      return
    }
    const phone = newUserType === 'Landlord' ? normalizeKenyanPhone(newUser.phone) : newUser.phone.trim()
    if (newUserType === 'Landlord' && !phone) {
      whatsappWindow?.close()
      setCreateError('Enter a valid Kenyan phone number with nine digits after +254.')
      return
    }
    try {
      await onCreateUser({ id: '', name: newUser.name.trim(), username: email, email, phone, userType: newUserType, role: newUser.role, active: true })
    } catch (error) {
      whatsappWindow?.close()
      setCreateError(error instanceof Error ? error.message : 'Could not send the Supabase invitation.')
      return
    }
    if (sendWhatsApp) {
      const message = [
        `Dear ${newUser.name.trim()},`,
        '',
        `You have been invited as a Landlord to ${workspaceName}.`,
        `Sign-in email: ${email}`,
        'Please accept the secure invitation sent to your email address to set your own password.',
        `After setting your password, sign in at ${window.location.origin}/landlord.`,
      ].join('\n')
      const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      if (whatsappWindow) {
        whatsappWindow.opener = null
        whatsappWindow.location.href = whatsappUrl
      } else {
        window.location.assign(whatsappUrl)
      }
    }
    setNewUser({ name: '', email: '', phone: '', role: defaultRoleForType[newUserType] })
    setCreateStep(1)
  }

  const startEdit = (user: AccessUser) => {
    setEditingUser(user)
    setEditForm({ name: user.name, username: user.username, email: user.email ?? '', phone: user.phone ?? '', userType: user.userType, role: user.role })
    setCreateError('')
  }

  const saveEdit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingUser) return
    setSavingUser(true)
    setCreateError('')
    try {
      const updated = { ...editingUser, ...editForm, username: editForm.email, email: editForm.email }
      await onUpdateUser(updated, editingUser)
      setEditingUser(null)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not update account.')
    } finally {
      setSavingUser(false)
    }
  }

  const confirmDelete = async (user: AccessUser) => {
    if (user.id === sessionUser.id) { alert('You cannot delete your own account.'); return }
    if (!window.confirm(`Delete "${user.name}" (@${user.username})? This cannot be undone.`)) return
    setCreateError('')
    setDeletingUserId(user.id)
    try { await onDeleteUser(user.id) }
    catch (error) { setCreateError(error instanceof Error ? error.message : 'Could not delete account.') }
    finally { setDeletingUserId(null) }
  }

  const updateUserActive = async (user: AccessUser, active: boolean) => {
    try {
      await (active ? onReconnect(user.id) : onDisconnect(user.id))
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not update account access.')
    }
  }

  const submitResetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!resetTarget?.email) { setResetMessage('This account has no email address.'); return }
    try {
      await onResetPassword(resetTarget.email)
      setResetMessage(`A reset link was sent to ${resetTarget.email}.`)
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : 'Could not send the reset email.')
    }
  }

  const reviewSubscriptionPayment = async (user: AccessUser, approve: boolean) => {
    const request = user.subscriptionRequest
    if (!request?.id || request.status !== 'pending') return
    const method = request.paymentMethod ?? 'paybill'
    const methodLabel = method === 'bank_transfer' ? 'bank transfer' : method === 'till' ? 'Till' : 'Paybill'
    const confirmation = approve
      ? `Confirm payment reference ${request.mpesaCode} for KSh ${request.amount.toLocaleString()} was received via ${methodLabel}?`
      : `Reject payment reference ${request.mpesaCode} for ${user.name}?`
    if (!window.confirm(confirmation)) return
    setPaymentActionId(request.id)
    setPaymentActionError('')
    setPaymentActionMessage('')
    try {
      await onReviewSubscriptionPayment(request.id, approve)
      setPaymentActionMessage(approve ? 'Payment verified and subscription activated.' : 'Payment request rejected.')
    } catch (error) {
      setPaymentActionError(error instanceof Error ? error.message : 'Could not review this subscription payment.')
    } finally {
      setPaymentActionId(null)
    }
  }

  const approvePublicLandlord = async (user: AccessUser) => {
    if (!window.confirm(`Approve ${user.name} and allow access to the rental system?`)) return
    setSignupActionId(user.id)
    setCreateError('')
    try { await onApproveLandlordSignup(user.id) }
    catch (error) { setCreateError(error instanceof Error ? error.message : 'Could not approve this registration.') }
    finally { setSignupActionId(null) }
  }

  const rejectPublicLandlord = async (user: AccessUser) => {
    if (!window.confirm(`Reject the landlord registration from ${user.name}?`)) return
    setSignupActionId(user.id)
    setCreateError('')
    try { await onRejectLandlordSignup(user.id) }
    catch (error) { setCreateError(error instanceof Error ? error.message : 'Could not reject this registration.') }
    finally { setSignupActionId(null) }
  }

  const roleBadgeColor: Record<AccessUser['role'], string> = {
    Administrator: 'role-admin', Manager: 'role-manager', Caretaker: 'role-caretaker', Accountant: 'role-accountant', Viewer: 'role-user'
  }

  const filteredUsers = filterType === 'All' ? users : users.filter(u => u.userType === filterType)
  const teamPageSize = 12
  const teamPageCount = Math.max(1, Math.ceil(filteredUsers.length / teamPageSize))
  const currentTeamPage = Math.min(teamPage, teamPageCount)
  const visibleUsers = filteredUsers.slice((currentTeamPage - 1) * teamPageSize, currentTeamPage * teamPageSize)
  const pendingSubscriptionUsers = users.filter(user => user.subscriptionRequest?.status === 'pending')
  const subscriptionPageSize = 10
  const subscriptionPageCount = Math.max(1, Math.ceil(pendingSubscriptionUsers.length / subscriptionPageSize))
  const currentSubscriptionPage = Math.min(subscriptionPage, subscriptionPageCount)
  const visibleSubscriptionUsers = pendingSubscriptionUsers.slice((currentSubscriptionPage - 1) * subscriptionPageSize, currentSubscriptionPage * subscriptionPageSize)
  const subscriptionHistoryPageCount = Math.max(1, Math.ceil(subscriptionHistoryTotal / 10))
  const currentSubscriptionHistoryPage = Math.min(subscriptionHistoryPage, subscriptionHistoryPageCount)
  const selectSubscriptionHistory = (filter: SubscriptionPaymentHistoryFilter | null) => {
    const alreadyOnFirstPage = filter === subscriptionHistoryFilter && subscriptionHistoryPage === 1
    setSubscriptionHistoryLoading(Boolean(filter))
    setSubscriptionHistoryError('')
    setSubscriptionHistoryFilter(filter)
    setSubscriptionHistoryPage(1)
    if (filter && alreadyOnFirstPage) setSubscriptionHistoryRefresh(value => value + 1)
  }
  const changeSubscriptionHistoryPage = (page: number) => {
    setSubscriptionHistoryLoading(true)
    setSubscriptionHistoryError('')
    setSubscriptionHistoryPage(page)
  }

  return (
    <section className="utility-view settings-page panel">
      <div className="utility-heading">
        <div><p className="eyebrow">Workspace</p><h2>Settings</h2><p>Manage your workspace, preferences, team, and account.</p></div>
      </div>
      <nav className="settings-jump-nav" aria-label="Settings sections">
        {([
          { id: 'workspace', label: 'Workspace' },
          ...(sessionUser.userType === 'Landlord' && sessionUser.role === 'Administrator' ? [{ id: 'rent-collection', label: 'Rent collection' }] : []),
          { id: 'notifications', label: 'Notifications' },
          { id: 'account', label: 'My account' },
          ...(canManageTeam ? [{ id: 'team-invites', label: 'Team invitations' }] : []),
          ...(canManageTeam ? [{ id: 'users', label: 'User directory' }] : []),
          ...(isPlatformAdmin ? [
            { id: 'subscription-method', label: 'Subscription collection' },
            { id: 'landlord-approvals', label: 'Landlord approvals' },
            { id: 'subscription-payments', label: 'Subscription payments' },
          ] : []),
          ...(sessionUser.userType === 'Landlord' && sessionUser.role === 'Administrator' ? [{ id: 'workspace-history', label: 'Workspace history' }] : []),
        ] as { id: SettingsSection; label: string }[]).map(item => (
          <button
            key={item.id}
            type="button"
            className={activeSettingsSection === item.id ? 'active' : ''}
            aria-current={activeSettingsSection === item.id ? 'page' : undefined}
            onClick={() => setActiveSettingsSection(item.id)}
          >{item.label}</button>
        ))}
      </nav>

      {/* Workspace Profile */}
      {activeSettingsSection === 'workspace' && <div className="settings-group" id="settings-workspace">
        <h3>Workspace profile</h3>
        <form onSubmit={saveWorkspace}>
          <label className="settings-field"><span>Workspace name</span><input value={wsName} onChange={e => setWsName(e.target.value)} readOnly={!isPlatformAdmin} title={!isPlatformAdmin ? 'Only the platform administrator can change the workspace name.' : undefined} required />{!isPlatformAdmin && <small>Only the platform administrator can change this name.</small>}</label>
          <label className="settings-field"><span>Property group</span><input value={wsPropGroup} onChange={e => setWsPropGroup(e.target.value)} required /></label>

          <button className="save-settings" type="submit">{wsSaved ? '✓ Saved!' : 'Save workspace'}</button>
        </form>
      </div>}

      {activeSettingsSection === 'rent-collection' && sessionUser.userType === 'Landlord' && sessionUser.role === 'Administrator' && <div className="settings-group" id="settings-rent-collection">
        <h3>Rent collection</h3>
        <p className="settings-description">Choose how tenants should pay rent. These details are included in tenant payment instructions and rent invoices.</p>
        <form onSubmit={saveWorkspace}>
          <label className="settings-field"><span>Preferred rent collection method</span>
            <select value={wsPaymentMethod} onChange={e => setWsPaymentMethod(e.target.value as LandlordPaymentMethod)}>
              <option value="paybill">Paybill</option>
              <option value="till">Till number</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
            <small>Platform subscription payments are configured separately by the Platform Administrator.</small>
          </label>
          {wsPaymentMethod === 'paybill' && <label className="settings-field"><span>Rent Paybill number</span><input inputMode="numeric" value={wsLandlordPaybill} onChange={e => setWsLandlordPaybill(e.target.value)} placeholder="e.g. 600247" /></label>}
          {wsPaymentMethod === 'till' && <label className="settings-field"><span>Till number</span><input inputMode="numeric" value={wsLandlordTillNumber} onChange={e => setWsLandlordTillNumber(e.target.value)} placeholder="e.g. 1234567" /></label>}
          {wsPaymentMethod === 'bank_transfer' && <>
            <label className="settings-field"><span>Bank name</span><input value={wsLandlordBankName} onChange={e => setWsLandlordBankName(e.target.value)} placeholder="e.g. Cooperative Bank" /></label>
            <label className="settings-field"><span>Account name</span><input value={wsLandlordBankAccountName} onChange={e => setWsLandlordBankAccountName(e.target.value)} placeholder="e.g. Jane Doe" /></label>
            <label className="settings-field"><span>Account number</span><input value={wsLandlordBankAccountNumber} onChange={e => setWsLandlordBankAccountNumber(e.target.value)} placeholder="e.g. 0123456789" /></label>
          </>}
          <button className="save-settings" type="submit">{wsSaved ? '✓ Saved!' : 'Save rent collection'}</button>
        </form>
        <div className="rent-paybill-setup">
          <div><strong>Direct Paybill rent collection</strong><small>{landlordPaymentMethod === 'paybill' && landlordPaybill ? `Configured Paybill: ${landlordPaybill}` : 'Select Paybill and save a rent Paybill number to register direct rent collection.'}</small></div>
          <button className="filter-button" type="button" disabled={landlordPaymentMethod !== 'paybill' || !landlordPaybill || registeringPaybill} onClick={async () => {
            setRegisteringPaybill(true)
            setPaybillSetupMessage('Registering with Safaricom...')
            try {
              await onRegisterRentPaybillCallbacks()
              setPaybillSetupMessage('Safaricom callback URLs registered successfully.')
            } catch (error) {
              setPaybillSetupMessage(error instanceof Error ? error.message : 'Could not register Paybill callbacks.')
            } finally {
              setRegisteringPaybill(false)
            }
          }}>{registeringPaybill ? 'Registering...' : 'Register Safaricom callbacks'}</button>
          {paybillSetupMessage && <small className="rent-paybill-setup-message" role="status">{paybillSetupMessage}</small>}
        </div>
      </div>}

      {/* Notifications */}
      {activeSettingsSection === 'notifications' && <div className="settings-group" id="settings-notifications">
        <h3>Notifications</h3>
        <button className="toggle-row" onClick={onToggleNotifEmail}>
          <span><strong>Email alerts</strong><small>Get notified about rent, maintenance, and lease changes.</small></span>
          <i className={notifEmail ? 'on' : ''}><b /></i>
        </button>
        <button className="toggle-row" onClick={onToggleNotifWeekly}>
          <span><strong>Weekly summary</strong><small>Receive a weekly overview of your portfolio activity.</small></span>
          <i className={notifWeekly ? 'on' : ''}><b /></i>
        </button>
        <button className="toggle-row" onClick={onToggleRentReminder}>
          <span><strong>Auto rent reminders</strong><small>Alert unpaid tenants before rent is due.</small></span>
          <i className={rentReminderEnabled ? 'on' : ''}><b /></i>
        </button>
        {rentReminderEnabled && (
          <div className="compact-form" style={{ marginTop: 10 }}>
            <label className="form-field"><span>Reminder window (days)</span><input type="number" min={1} max={30} value={rentReminderDays} onChange={e => onChangeRentReminderDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} /></label>
            <label className="form-field"><span>Default delivery channel</span><select value={rentReminderChannel} onChange={e => onChangeRentReminderChannel(e.target.value as RentReminderChannel)}>
              <option value="WhatsApp">WhatsApp</option>
              <option value="Email">Email</option>
            </select></label>
          </div>
        )}
      </div>}

      {/* My Account */}
      {activeSettingsSection === 'account' && <div className="settings-group" id="settings-account">
        <h3>My account</h3>
        <div className="my-account-card">
          <span className="user-avatar">{sessionUser.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{sessionUser.name}</strong>
            <small>@{sessionUser.username} · <span className={`role-badge ${roleBadgeColor[sessionUser.role]}`}>{sessionUser.role}</span></small>
            <small style={{ marginTop: 4 }}>{userTypeConfig[sessionUser.userType]?.icon} {sessionUser.userType}</small>
          </div>
          <button className="filter-button" style={{ marginLeft: 'auto' }} onClick={() => { setResetTarget(sessionUser); setResetMessage('') }}>Change password</button>
        </div>
      </div>}

      {/* System Access — admin only */}
      {canManageTeam && ['team-invites', 'subscription-method', 'landlord-approvals', 'users', 'subscription-payments'].includes(activeSettingsSection) && (
        <div className="settings-group access-group" id="settings-team">
          {activeSettingsSection === 'team-invites' && <div className="access-heading">
            <div>
              <h3>Team access</h3>
              <p>{isPlatformAdmin ? 'Invite Landlords to create their own rental workspaces.' : 'Invite Caretakers to help manage your rental workspace.'}</p>
            </div>
            <ShieldCheck size={20} />
          </div>}

          {isPlatformAdmin && activeSettingsSection === 'subscription-method' && <PlatformSubscriptionPaymentSettings userId={sessionUser.id} onSaved={onSaveSubscriptionPaymentDetails} />}

          {/* ── STEP 1: Choose user type ── */}
          {activeSettingsSection === 'team-invites' && createStep === 1 && (
            <div className="user-type-step">
              <p className="user-type-step-label">Step 1 — Who are you adding?</p>
              <div className="user-type-cards">
                {inviteTypes.map(type => {
                  const cfg = userTypeConfig[type]
                  return (
                    <button key={type} className={`user-type-card ${cfg.color}`} onClick={() => goToStep2(type)}>
                      <span className="utc-emoji">{cfg.icon}</span>
                      <strong>{type}</strong>
                      <small>{cfg.description}</small>
                      <span className="utc-roles">
                        {rolesForType[type].map(r => <span key={r} className={`role-badge ${roleBadgeColor[r]}`}>{r}</span>)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── STEP 2: Fill in details ── */}
          {activeSettingsSection === 'team-invites' && createStep === 2 && (
            <div className="user-create-step2">
              <div className="step2-header">
                <button className="step2-back" onClick={() => setCreateStep(1)}>← Back</button>
                <span className={`user-type-pill ${userTypeConfig[newUserType].color}`}>
                  {userTypeConfig[newUserType].icon} Adding a {newUserType}
                </span>
              </div>
              <form className="user-create-form-v2" onSubmit={createUser}>
                <div className="ucf-grid">
                  <label className="form-field"><span>Full name</span><input required placeholder="e.g. Jane Muthoni" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} /></label>
                  <label className="form-field"><span>Email address</span><input required type="email" placeholder="e.g. jane@example.com" value={newUser.email} onChange={e => setNewUser({ ...newUser, email: e.target.value })} /></label>
                  {isPlatformAdmin && newUserType === 'Landlord'
                    ? <label className="form-field"><span>WhatsApp number</span><div className="kenyan-phone-input"><span>+254</span><input required type="tel" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} placeholder="712345678" aria-label="Landlord WhatsApp number, nine digits after country code 254" value={getKenyanPhoneDigits(newUser.phone)} onChange={e => setNewUser({ ...newUser, phone: e.target.value.replace(/\D/g, '').slice(0, 9) })} /></div></label>
                    : <label className="form-field"><span>Phone (optional)</span><input type="tel" placeholder="e.g. 0712 345 678" value={newUser.phone} onChange={e => setNewUser({ ...newUser, phone: e.target.value })} /></label>}
                  <p className="form-hint">Supabase will email a secure invitation link so this user can set their own password.</p>
                  <label className="form-field">
                    <span>System role</span>
                    <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as AccessUser['role'] })}>
                      {rolesForType[newUserType].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </label>
                </div>
                <div className="role-descriptions">
                  <p className="role-desc-label">Role permissions guide</p>
                  <div className="role-desc-grid">
                    {rolesForType[newUserType].map(r => (
                      <div key={r} className={`role-desc-item role-badge ${roleBadgeColor[r]}`}>
                        <strong>{r}</strong>
                        <small>{{
                          Administrator: 'Full access to everything including user management',
                          Manager: 'Manage properties, tenants, payments and maintenance',
                          Caretaker: 'Log maintenance, unit health, and resident issues quickly.',
                          Accountant: 'View and manage payments and expenses only',
                          Viewer: 'Read-only access to the workspace',
                        }[r]}</small>
                      </div>
                    ))}
                  </div>
                </div>
                {createError && <p className="settings-error">{createError}</p>}
                <div className="modal-actions" style={{ padding: 0, border: 'none', marginTop: 20 }}>
                  <button type="button" className="cancel-button" onClick={() => setCreateStep(1)}>Cancel</button>
                  <button type="submit" className={isPlatformAdmin && newUserType === 'Landlord' ? 'cancel-button' : 'primary-button'}><UserPlus size={15} /> Add {newUserType}</button>
                  {isPlatformAdmin && newUserType === 'Landlord' && <button type="submit" className="primary-button" name="submitAction" value="add-and-whatsapp"><MessageCircle size={15} /> Add &amp; WhatsApp</button>}
                </div>
              </form>
            </div>
          )}

          {isPlatformAdmin && activeSettingsSection === 'landlord-approvals' && <section className="subscription-review landlord-signup-review" id="settings-landlord-approvals">
            <div className="subscription-review-heading">
              <div><h3>Landlord registrations awaiting approval</h3><p>Approve access before a new landlord can open their workspace.</p></div>
              <span className="subscription-review-count">{users.filter(user => user.userType === 'Landlord' && user.signupStatus === 'pending').length} pending</span>
            </div>
            {createError && <p className="settings-error" role="alert">{createError}</p>}
            <div className="subscription-payment-list">
              {users.filter(user => user.userType === 'Landlord' && user.signupStatus === 'pending').map(user => <article className="subscription-payment-row" key={user.id}>
                <div className="subscription-payment-person"><span className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><small>{user.email || user.username} · {user.phone || 'No phone provided'}</small></div></div>
                <div className="subscription-payment-details"><span>Selected plan</span><strong>{user.requestedPlan === 'test' ? 'Test · Free for one month' : user.requestedPlan === 'silver_monthly' ? 'Silver Monthly · KSh 500' : user.requestedPlan === 'silver_yearly' ? 'Silver Yearly · KSh 4,500' : 'Plan not selected'}</strong></div>
                <div className="subscription-payment-actions">
                  <button type="button" className="subscription-reject-button" disabled={signupActionId === user.id} onClick={() => void rejectPublicLandlord(user)}>Reject</button>
                  <button type="button" className="subscription-approve-button" disabled={signupActionId === user.id} onClick={() => void approvePublicLandlord(user)}>{signupActionId === user.id ? 'Saving...' : 'Approve access'}</button>
                </div>
              </article>)}
              {users.every(user => user.userType !== 'Landlord' || user.signupStatus !== 'pending') && <p className="subscription-review-empty">No landlord registrations are waiting for approval.</p>}
            </div>
          </section>}

          {/* User list with filter */}
          {activeSettingsSection === 'users' && <><div className="user-list-header" id="settings-users">
            <strong>{users.length} team member{users.length !== 1 ? 's' : ''}</strong>
            <div className="user-type-filter">
              {(['All', 'Landlord', 'Property Manager', 'Caretaker'] as (AccessUser['userType'] | 'All')[]).map(t => (
                <button key={t} className={`utf-btn ${filterType === t ? 'active' : ''}`} onClick={() => { setFilterType(t); setTeamPage(1) }}>{t}</button>
              ))}
            </div>
          </div>

          {createError && <p className="settings-error" role="alert">{createError}</p>}
          <div className="user-list">
            {visibleUsers.map(user => (
              <div className="user-row" key={user.id}>
                <span className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{user.name}</strong>
                  <small>
                    @{user.username}
                    {user.email && <> · {user.email}</>}
                  </small>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <span className={`user-type-pill-sm ${userTypeConfig[user.userType]?.color ?? 'ut-landlord'}`}>
                      {userTypeConfig[user.userType]?.icon} {user.userType}
                    </span>
                    <span className={`role-badge ${roleBadgeColor[user.role]}`}>{user.role}</span>
                  </div>
                  {user.managedProperties?.length ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {user.managedProperties.map((entry, idx) => (
                        <span key={`${entry.property}-${entry.unit}-${idx}`} className="role-badge role-user" style={{ fontSize: 11 }}>
                          {entry.property} · {entry.unit}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <span className={`access-status ${user.active ? 'connected' : 'disconnected'}`}>{user.active ? 'Active' : 'Suspended'}</span>
                <div className="user-actions">
                  <button type="button" className="user-action-btn edit" title="Edit user" aria-label={`Edit ${user.name}`} onClick={() => startEdit(user)}>✏️</button>
                  <button type="button" className="user-action-btn key" title="Send password reset email" aria-label={`Send password reset email to ${user.name}`} onClick={() => { setResetTarget(user); setResetMessage('') }}>🔑</button>
                  {user.active
                    ? <button type="button" className="user-action-btn suspend" title="Suspend" aria-label={`Suspend ${user.name}`} onClick={() => updateUserActive(user, false)} disabled={user.id === sessionUser.id}>⏸</button>
                    : <button type="button" className="user-action-btn restore" title="Restore" aria-label={`Restore ${user.name}`} onClick={() => updateUserActive(user, true)}>▶️</button>}
                  {user.id !== sessionUser.id && (
                    <button type="button" className="user-action-btn delete" title={deletingUserId === user.id ? 'Deleting user' : 'Delete'} aria-label={`Delete ${user.name}`} disabled={deletingUserId !== null} onClick={() => void confirmDelete(user)}>{deletingUserId === user.id ? '…' : '🗑️'}</button>
                  )}
                </div>
              </div>
            ))}
            {filteredUsers.length === 0 && <p className="overview-empty" style={{ padding: '20px 0' }}>No {filterType !== 'All' ? filterType : ''} users found.</p>}
          </div>
          {filteredUsers.length > teamPageSize && <Pagination page={currentTeamPage} pageCount={teamPageCount} onPageChange={setTeamPage} />}</>}

          {isPlatformAdmin && activeSettingsSection === 'subscription-payments' && <div className="subscription-review" id="settings-subscription-payments">
            <div className="subscription-review-heading">
              <div>
                <h3>Subscription payments</h3>
                <p>{subscriptionHistoryFilter ? 'Review previously processed subscription payments.' : 'Verify subscription payments before activating a plan.'}</p>
              </div>
              <span className="subscription-review-count">{subscriptionHistoryFilter ? `${subscriptionHistoryTotal} ${subscriptionHistoryFilter === 'all' ? 'processed' : subscriptionHistoryFilter}` : `${pendingSubscriptionUsers.length} pending`}</span>
            </div>
            {!subscriptionHistoryFilter && <p className="subscription-review-note">Verify each payment reference and amount against the configured subscription collection method before approving.</p>}
            {paymentActionError && <p className="subscription-payment-error" role="alert">{paymentActionError}</p>}
            {paymentActionMessage && <p className="subscription-payment-success" role="status">{paymentActionMessage}</p>}
            <div className="subscription-history-controls" role="group" aria-label="Subscription payment views">
              <button type="button" className={!subscriptionHistoryFilter ? 'active' : ''} aria-pressed={!subscriptionHistoryFilter} onClick={() => { selectSubscriptionHistory(null); setSubscriptionPage(1) }}>Pending</button>
              {(['approved', 'rejected', 'all'] as SubscriptionPaymentHistoryFilter[]).map(filter => (
                <button key={filter} type="button" className={subscriptionHistoryFilter === filter ? 'active' : ''} aria-pressed={subscriptionHistoryFilter === filter} onClick={() => selectSubscriptionHistory(filter)}>
                  {filter === 'all' ? 'All processed' : filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ))}
              {subscriptionHistoryFilter && <button type="button" className="subscription-history-refresh" disabled={subscriptionHistoryLoading} onClick={() => { setSubscriptionHistoryLoading(true); setSubscriptionHistoryError(''); setSubscriptionHistoryRefresh(value => value + 1) }}>{subscriptionHistoryLoading ? 'Loading…' : 'Refresh'}</button>}
            </div>
            {!subscriptionHistoryFilter && <div className="subscription-payment-list">
              {visibleSubscriptionUsers.map(user => {
                const request = user.subscriptionRequest!
                return <article className="subscription-payment-row" key={user.id}>
                  <div className="subscription-payment-person">
                    <span className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</span>
                    <div><strong>{user.name}</strong><small>@{user.username} · Submitted {new Date(request.submittedAt).toLocaleString()}</small></div>
                  </div>
                  <div className="subscription-payment-details">
                    <span>{request.plan === 'silver_monthly' ? 'Silver Monthly' : request.plan === 'silver_yearly' ? 'Silver Yearly' : request.plan === 'monthly' ? 'Legacy Monthly' : 'Legacy Yearly'} plan</span>
                    <strong>KSh {request.amount.toLocaleString()}</strong>
                    <small>{request.paymentMethod === 'bank_transfer' ? 'Bank reference' : request.paymentMethod === 'till' ? 'Till transaction code' : 'Paybill transaction code'} <b>{request.mpesaCode}</b></small>
                    <small>Paid via {request.paymentMethod === 'bank_transfer' ? 'Bank transfer' : request.paymentMethod === 'till' ? 'Till' : 'Paybill'}</small>
                  </div>
                  <div className="subscription-payment-actions">
                    <button type="button" className="subscription-reject-button" disabled={paymentActionId === request.id} onClick={() => void reviewSubscriptionPayment(user, false)}>{paymentActionId === request.id ? 'Saving…' : 'Reject'}</button>
                    <button type="button" className="subscription-approve-button" disabled={paymentActionId === request.id} onClick={() => void reviewSubscriptionPayment(user, true)}>{paymentActionId === request.id ? <><RefreshCw size={14} className="subscription-action-spinner" /> Activating…</> : <><CheckCircle2 size={14} /> Confirm &amp; activate</>}</button>
                  </div>
                </article>
              })}
              {pendingSubscriptionUsers.length === 0 && <p className="subscription-review-empty">No payments are waiting for verification.</p>}
            </div>}
            {pendingSubscriptionUsers.length > subscriptionPageSize && <Pagination page={currentSubscriptionPage} pageCount={subscriptionPageCount} onPageChange={setSubscriptionPage} />}
            {subscriptionHistoryFilter && subscriptionHistoryError && <p className="subscription-payment-error" role="alert">{subscriptionHistoryError}</p>}
            {subscriptionHistoryFilter && subscriptionHistoryLoading && <p className="subscription-review-empty" role="status">Loading subscription payment history…</p>}
            {subscriptionHistoryFilter && !subscriptionHistoryLoading && !subscriptionHistoryError && <>
              <div className="subscription-payment-list">
                {subscriptionHistoryRows.map(request => (
                  <article className="subscription-payment-row subscription-history-row" key={request.request_id}>
                    <div className="subscription-payment-person">
                      <span className="user-avatar">{(request.profile_name || request.profile_email || 'U').slice(0, 2).toUpperCase()}</span>
                      <div><strong>{request.profile_name || request.profile_email || 'User'}</strong><small>{request.profile_email || request.user_id} · Submitted {new Date(request.submitted_at).toLocaleString()}</small></div>
                    </div>
                    <div className="subscription-payment-details">
                      <span>{request.plan === 'silver_monthly' ? 'Silver Monthly' : request.plan === 'silver_yearly' ? 'Silver Yearly' : request.plan === 'monthly' ? 'Legacy Monthly' : 'Legacy Yearly'} plan</span>
                      <strong>KSh {request.amount.toLocaleString()}</strong>
                      <small>{request.payment_method === 'bank_transfer' ? 'Bank reference' : request.payment_method === 'till' ? 'Till transaction code' : 'Paybill transaction code'} <b>{request.mpesa_code}</b></small>
                      <small>Reviewed {request.reviewed_at ? new Date(request.reviewed_at).toLocaleString() : '—'}</small>
                    </div>
                    <span className={`subscription-history-status ${request.status}`}>{request.status}</span>
                  </article>
                ))}
                {subscriptionHistoryRows.length === 0 && <p className="subscription-review-empty">No {subscriptionHistoryFilter === 'all' ? 'processed' : subscriptionHistoryFilter} subscription payments found.</p>}
              </div>
              {subscriptionHistoryTotal > 10 && <Pagination page={currentSubscriptionHistoryPage} pageCount={subscriptionHistoryPageCount} onPageChange={changeSubscriptionHistoryPage} />}
            </>}
          </div>}
        </div>
      )}

      {/* Edit user modal */}
      {editingUser && (
        <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingUser(null) }}>
          <form className="add-modal" onSubmit={saveEdit}>
            <button type="button" className="modal-close" onClick={() => setEditingUser(null)}>×</button>
            <p className="eyebrow">User management</p>
            <h2>Edit user</h2>
            <p className="modal-description">Update details for <strong>{editingUser.name}</strong>.</p>
            <label className="form-field"><span>Full name</span><input required value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></label>
            <label className="form-field"><span>Email address</span><input required type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value, username: e.target.value })} /></label>
            <label className="form-field"><span>Phone</span><input type="tel" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></label>
            <label className="form-field">
              <span>System role</span>
              <select value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value as AccessUser['role'] })}>
                {rolesForType[editForm.userType].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {createError && <p className="settings-error">{createError}</p>}
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => setEditingUser(null)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={savingUser}>{savingUser ? 'Saving...' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Reset password modal */}
      {resetTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setResetTarget(null) }}>
          <form className="add-modal" onSubmit={submitResetPassword}>
            <button type="button" className="modal-close" onClick={() => setResetTarget(null)}>×</button>
            <p className="eyebrow">Security</p>
            <h2>Send password reset</h2>
            <p className="modal-description">Send a secure password reset link to <strong>{resetTarget.email || resetTarget.username}</strong>.</p>
            {resetMessage && <p className="settings-saved-msg">{resetMessage}</p>}
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => setResetTarget(null)}>Cancel</button>
              <button type="submit" className="primary-button">Send reset link</button>
            </div>
          </form>
        </div>
      )}
      {activeSettingsSection === 'workspace-history' && sessionUser.userType === 'Landlord' && sessionUser.role === 'Administrator' && <WorkspaceHistoryPanel ownerId={sessionUser.id} users={users} />}
    </section>
  )
}

type WorkspaceAuditEntry = { id: number; actor_id: string | null; action: string; changed_at: string; changed_sections: string[]; before_values: Record<string, unknown>; after_values: Record<string, unknown> }
type WorkspaceBackupEntry = { id: string; backup_date: string; created_at: string }

function PlatformSubscriptionPaymentSettings({ userId, onSaved }: { userId: string; onSaved: (details: SubscriptionPaymentDetails) => void }) {
  const [details, setDetails] = useState<SubscriptionPaymentDetails>(defaultSubscriptionPaymentDetails)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!supabase) {
        setMessage('Supabase is not configured.')
        setLoading(false)
        return
      }
      const { data, error } = await supabase.from('subscription_payment_settings')
        .select('payment_method, paybill_number, till_number, bank_name, bank_account_name, bank_account_number')
        .eq('id', true)
        .maybeSingle()
      if (!active) return
      if (error) setMessage(`Could not load subscription payment settings: ${error.message}`)
      else if (data) setDetails({
        method: data.payment_method as LandlordPaymentMethod,
        paybillNumber: data.paybill_number,
        tillNumber: data.till_number,
        bankName: data.bank_name,
        bankAccountName: data.bank_account_name,
        bankAccountNumber: data.bank_account_number,
      })
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [userId])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || saving) return
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('subscription_payment_settings').upsert({
      id: true,
      payment_method: details.method,
      paybill_number: details.paybillNumber.trim(),
      till_number: details.tillNumber.trim(),
      bank_name: details.bankName.trim(),
      bank_account_name: details.bankAccountName.trim(),
      bank_account_number: details.bankAccountNumber.trim(),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    setSaving(false)
    if (error) {
      setMessage(`Could not save subscription payment settings: ${error.message}`)
      return
    }
    onSaved(details)
    setMessage('Subscription payment instructions saved.')
  }

  const updateDetails = (field: keyof SubscriptionPaymentDetails, value: string) => setDetails(current => ({ ...current, [field]: value }))

  return <section className="platform-subscription-settings">
    <div className="platform-subscription-settings-heading"><div><h3>Subscription collection method</h3><p>These details are shown to Landlords when they pay for their subscription. Separate from rent collection settings.</p></div></div>
    <form onSubmit={save}>
      <label className="settings-field"><span>Payment method</span><select value={details.method} onChange={event => updateDetails('method', event.target.value as LandlordPaymentMethod)}>
        <option value="paybill">Paybill</option><option value="till">Till number</option><option value="bank_transfer">Bank transfer</option>
      </select></label>
      {details.method === 'paybill' && <label className="settings-field"><span>Subscription Paybill number</span><input required value={details.paybillNumber} onChange={event => updateDetails('paybillNumber', event.target.value)} placeholder="Enter Paybill number" /></label>}
      {details.method === 'till' && <label className="settings-field"><span>Subscription Till number</span><input required value={details.tillNumber} onChange={event => updateDetails('tillNumber', event.target.value)} placeholder="Enter Till number" /></label>}
      {details.method === 'bank_transfer' && <>
        <label className="settings-field"><span>Bank name</span><input required value={details.bankName} onChange={event => updateDetails('bankName', event.target.value)} placeholder="Enter bank name" /></label>
        <label className="settings-field"><span>Account name</span><input required value={details.bankAccountName} onChange={event => updateDetails('bankAccountName', event.target.value)} placeholder="Enter account name" /></label>
        <label className="settings-field"><span>Account number</span><input required value={details.bankAccountNumber} onChange={event => updateDetails('bankAccountNumber', event.target.value)} placeholder="Enter account number" /></label>
      </>}
      <button className="save-settings" type="submit" disabled={loading || saving}>{loading ? 'Loading...' : saving ? 'Saving...' : 'Save subscription payment details'}</button>
      {message && <small className={message.startsWith('Could not') ? 'settings-error' : 'settings-saved-msg'} role="status">{message}</small>}
    </form>
  </section>
}

function WorkspaceHistoryPanel({ ownerId, users }: { ownerId: string; users: AccessUser[] }) {
  const [auditEntries, setAuditEntries] = useState<WorkspaceAuditEntry[]>([])
  const [backupEntries, setBackupEntries] = useState<WorkspaceBackupEntry[]>([])
  const [auditCount, setAuditCount] = useState(0)
  const [backupCount, setBackupCount] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [backupPage, setBackupPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [restoreMessage, setRestoreMessage] = useState('')
  const [restoringBackup, setRestoringBackup] = useState('')
  const [deletingBackup, setDeletingBackup] = useState('')
  const pageSize = 10

  useEffect(() => {
    let active = true
    const loadHistory = async () => {
      if (!supabase) {
        setHistoryError('Supabase is not configured.')
        setHistoryLoading(false)
        return
      }
      setHistoryLoading(true)
      setHistoryError('')
      const auditFrom = (auditPage - 1) * pageSize
      const backupFrom = (backupPage - 1) * pageSize
      const [auditResult, backupResult] = await Promise.all([
        supabase.from('rental_workspace_audit').select('id, actor_id, action, changed_at, changed_sections, before_values, after_values', { count: 'exact' }).eq('owner_id', ownerId).order('changed_at', { ascending: false }).range(auditFrom, auditFrom + pageSize - 1),
        supabase.from('rental_workspace_backups').select('id, backup_date, created_at', { count: 'exact' }).eq('owner_id', ownerId).order('created_at', { ascending: false }).range(backupFrom, backupFrom + pageSize - 1),
      ])
      if (!active) return
      if (auditResult.error || backupResult.error) {
        setHistoryError(auditResult.error?.message ?? backupResult.error?.message ?? 'Could not load workspace history.')
      } else {
        setAuditEntries((auditResult.data ?? []) as WorkspaceAuditEntry[])
        setBackupEntries((backupResult.data ?? []) as WorkspaceBackupEntry[])
        setAuditCount(auditResult.count ?? 0)
        setBackupCount(backupResult.count ?? 0)
      }
      setHistoryLoading(false)
      setRefreshing(false)
    }
    void loadHistory()
    return () => { active = false }
  }, [ownerId, auditPage, backupPage, refreshKey])

  const refreshHistory = () => {
    setRefreshing(true)
    setRefreshKey(value => value + 1)
  }

  const restoreBackup = async (backup: WorkspaceBackupEntry) => {
    if (!supabase || !window.confirm(`Restore the workspace to its backup from ${backup.backup_date}? Current data will be replaced. The current state will be recorded in the audit history.`)) return
    setRestoringBackup(backup.id)
    setHistoryError('')
    setRestoreMessage('')
    const { error } = await supabase.rpc('restore_rental_workspace_backup', { p_backup_id: backup.id })
    if (error) {
      setHistoryError(error.message)
      setRestoringBackup('')
      return
    }
    setRestoreMessage('Backup restored. Reloading your workspace...')
    window.location.reload()
  }

  const deleteBackup = async (backup: WorkspaceBackupEntry) => {
    if (!supabase || !window.confirm(`Permanently delete the workspace backup from ${backup.backup_date}? This cannot be undone.`)) return
    setDeletingBackup(backup.id)
    setHistoryError('')
    setRestoreMessage('')
    const { error } = await supabase.rpc('delete_rental_workspace_backup', { p_backup_id: backup.id })
    if (error) {
      setHistoryError(`Could not delete workspace backup: ${error.message}`)
      setDeletingBackup('')
      return
    }
    setRestoreMessage(`Backup from ${backup.backup_date} deleted.`)
    if (backupEntries.length === 1 && backupPage > 1) setBackupPage(current => current - 1)
    else refreshHistory()
    setDeletingBackup('')
  }

  return <div className="settings-group workspace-history-group">
    <div className="access-heading"><div><h3>Workspace history &amp; backups</h3><p>Review recent changes and restore a daily workspace snapshot.</p></div><button type="button" className="filter-button workspace-history-refresh" onClick={refreshHistory} disabled={historyLoading || refreshing} aria-label="Refresh workspace history and backups" title="Refresh workspace history and backups"><RefreshCw size={16} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Refreshing...' : 'Refresh'}</button></div>
    {historyLoading && <p className="overview-empty">Loading workspace history...</p>}
    {historyError && <p className="settings-error" role="alert">{historyError}</p>}
    {restoreMessage && <p className="settings-saved-msg" role="status">{restoreMessage}</p>}
    {!historyLoading && !historyError && <>
      <div className="workspace-history-columns">
        <section>
          <h4>Recent changes</h4>
          {auditEntries.length ? <div className="workspace-history-list">{auditEntries.map(entry => <details className="workspace-history-entry" key={entry.id}>
            <summary><strong>{entry.action === 'created' ? 'Workspace created' : `Updated: ${entry.changed_sections.join(', ')}`}</strong><small>{entry.actor_id === ownerId ? 'You' : users.find(user => user.id === entry.actor_id)?.name ?? (entry.actor_id ? `Team member ${entry.actor_id.slice(0, 8)}` : 'System')} · {new Date(entry.changed_at).toLocaleString()}</small></summary>
            <pre>{JSON.stringify({ before: entry.before_values, after: entry.after_values }, null, 2)}</pre>
          </details>)}</div> : <p className="overview-empty">No workspace changes are recorded yet.</p>}
          {auditCount > pageSize && <Pagination page={auditPage} pageCount={Math.ceil(auditCount / pageSize)} onPageChange={setAuditPage} />}
        </section>
        <section>
          <h4>Daily backups</h4>
          {backupEntries.length ? <div className="workspace-backup-list">{backupEntries.map(backup => <article className="workspace-backup-entry" key={backup.id}>
            <span><strong>{new Date(`${backup.backup_date}T00:00:00`).toLocaleDateString()}</strong><small>Saved {new Date(backup.created_at).toLocaleTimeString()}</small></span>
            <div className="workspace-backup-actions">
              <button type="button" className="filter-button" disabled={Boolean(restoringBackup || deletingBackup)} onClick={() => void restoreBackup(backup)}>{restoringBackup === backup.id ? 'Restoring...' : 'Restore'}</button>
              <button type="button" className="card-delete-btn workspace-backup-delete" disabled={Boolean(restoringBackup || deletingBackup)} onClick={() => void deleteBackup(backup)} aria-label={`Delete backup from ${backup.backup_date}`} title="Delete backup">{deletingBackup === backup.id ? 'Deleting...' : <><Trash2 size={14} />Delete</>}</button>
            </div>
          </article>)}</div> : <p className="overview-empty">No daily backups are available yet.</p>}
          {backupCount > pageSize && <Pagination page={backupPage} pageCount={Math.ceil(backupCount / pageSize)} onPageChange={setBackupPage} />}
        </section>
      </div>
      <small className="workspace-history-retention">Daily backups and change records are retained for 365 days. Use the page controls to browse older entries.</small>
    </>}
  </div>
}

function OperationsCenter({ tenants, properties, payments, expenses, applicants, workspaceName, onAddExpense, onAddApplicant, onGenerateInvoice, onEditExpense, onDeleteExpense, onToggleExpensePaid, onApplicantAction }: { tenants: TenantRecord[]; properties: PropertyRecord[]; payments: string[]; expenses: ExpenseRecord[]; applicants: ApplicantRecord[]; workspaceName: string; onAddExpense: (expense: ExpenseRecord) => void; onAddApplicant: (applicant: ApplicantRecord) => void; onGenerateInvoice: (tenant: TenantRecord) => void; onEditExpense?: (expense: ExpenseRecord) => void; onDeleteExpense?: (id: string) => void; onToggleExpensePaid?: (id: string) => void; onApplicantAction?: (id: string, action: 'approve' | 'reject' | 'schedule' | 'convert') => void }) {
  const directRentPayments = useContext(ConfirmedRentPaymentsContext)
  const paymentDetails = useContext(LandlordPaybillContext)
  const [expenseForm, setExpenseForm] = useState({ category: 'Repairs', property: '', amount: '', date: new Date().toISOString().slice(0, 10), note: '' })
  const [applicantForm, setApplicantForm] = useState({ name: '', phone: '', property: '', unit: '', stage: 'Viewing' as ApplicantRecord['stage'] })
  const [exportMonth, setExportMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [exportProperty, setExportProperty] = useState('All properties')
  const [exportUnit, setExportUnit] = useState('All units')
  const [rentTrackerPage, setRentTrackerPage] = useState(1)
  const [expensePage, setExpensePage] = useState(1)
  const [applicantPage, setApplicantPage] = useState(1)
  const operationsPageSize = 5
  const rentTrackerPageCount = Math.max(1, Math.ceil(tenants.length / operationsPageSize))
  const expensePageCount = Math.max(1, Math.ceil(expenses.length / operationsPageSize))
  const applicantPageCount = Math.max(1, Math.ceil(applicants.length / operationsPageSize))
  const visibleRentTrackerTenants = tenants.slice((Math.min(rentTrackerPage, rentTrackerPageCount) - 1) * operationsPageSize, Math.min(rentTrackerPage, rentTrackerPageCount) * operationsPageSize)
  const visibleExpenses = expenses.slice((Math.min(expensePage, expensePageCount) - 1) * operationsPageSize, Math.min(expensePage, expensePageCount) * operationsPageSize)
  const visibleApplicants = applicants.slice((Math.min(applicantPage, applicantPageCount) - 1) * operationsPageSize, Math.min(applicantPage, applicantPageCount) * operationsPageSize)
  const totalCollected = payments.reduce((total, row) => total + (Number(row.split(' · ')[0].replace(/[^0-9.]/g, '')) || 0), 0)
  const totalExpenses = expenses.reduce((total, expense) => total + expense.amount, 0)

  const availableExportProperties = useMemo(() => ['All properties', ...new Set(tenants.map((tenant) => tenant.property))], [tenants])
  const availableExportUnits = useMemo(() => {
    const propertyUnits = exportProperty === 'All properties' ? tenants : tenants.filter((tenant) => tenant.property === exportProperty)
    return ['All units', ...Array.from(new Set(propertyUnits.map((tenant) => tenant.unit)))]
  }, [exportProperty, tenants])

  const normalizeUnitLabel = (value: string) => value.replace(/^House\s+/i, '').trim()

  const getMonthMatches = (value?: string, targetMonth?: string) => {
    if (!targetMonth || targetMonth === 'all') return true
    if (!value) return false
    if (value.startsWith(targetMonth)) return true
    const parsed = new Date(`${value}T00:00:00`)
    if (!Number.isNaN(parsed.getTime())) {
      const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`
      return iso === targetMonth
    }
    return false
  }

  const download = (filename: string, data: string, type = 'text/csv;charset=utf-8') => {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportLedger = () => {
    type CsvLedgerRow = {
      Type: string
      Property: string
      Unit: string
      Tenant: string
      Amount: number
      Date: string
      Method: string
      Reference: string
      Period: string
      Rent?: number
      Water?: number
      PaidStatus?: 'Paid' | 'Partially paid' | 'Unpaid'
      OutstandingBalance?: number
    }

    const tenantMonthlyRows: CsvLedgerRow[] = tenants
      .filter((tenant) => {
        const propertyMatches = exportProperty === 'All properties' || tenant.property === exportProperty
        const unitMatches = exportUnit === 'All units' || normalizeUnitLabel(tenant.unit) === exportUnit
        const rentAmount = Number(String(tenant.rent).replace(/[^0-9.]/g, '')) || 0
        const waterAmount = Number(String(tenant.waterBill ?? '0').replace(/[^0-9.]/g, '')) || 0
        const hasRelevantData = rentAmount > 0 || waterAmount > 0
        const updatedAt = tenant.waterBillUpdatedAt ?? ''
        const monthMatchesValue = getMonthMatches(updatedAt, exportMonth)
        return propertyMatches && unitMatches && hasRelevantData && (monthMatchesValue || rentAmount > 0)
      })
      .map((tenant) => {
        const rentAmount = Number(String(tenant.rent).replace(/[^0-9.]/g, '')) || 0
        const waterAmount = Number(String(tenant.waterBill ?? '0').replace(/[^0-9.]/g, '')) || 0
        const totalDue = rentAmount + waterAmount
        const paidThisMonth = payments.reduce((total, row) => {
          const parts = row.split(' · ')
          const amount = Number(parts[0].replace(/[^0-9.]/g, '')) || 0
          const rowTenant = parts[1] ?? ''
          const rowUnit = parts[2] ?? ''
          const rowProperty = parts[3] ?? ''
          const rowDate = parts[4] ?? ''
          const rowPeriod = parts[7] ?? ''
          const monthMatches = getMonthMatches(rowDate || rowPeriod, exportMonth)
          if (rowProperty === tenant.property && normalizeUnitLabel(rowUnit) === normalizeUnitLabel(tenant.unit) && rowTenant === tenant.name && monthMatches) {
            return total + amount
          }
          return total
        }, 0) + directRentPayments.reduce((total, payment) => {
          const paymentMonth = new Date(payment.transacted_at).toISOString().slice(0, 7)
          if (payment.property_name === tenant.property && normalizeUnitLabel(payment.unit_name) === normalizeUnitLabel(tenant.unit) && paymentMonth === exportMonth) {
            return total + Number(payment.amount || 0)
          }
          return total
        }, 0)
        const outstandingBalance = Math.max(totalDue - paidThisMonth, 0)
        const paidStatus: CsvLedgerRow['PaidStatus'] = paidThisMonth >= totalDue ? 'Paid' : paidThisMonth > 0 ? 'Partially paid' : 'Unpaid'
        return {
          Type: 'Tenant monthly total',
          Property: tenant.property,
          Unit: normalizeUnitLabel(tenant.unit),
          Tenant: tenant.name,
          Amount: totalDue,
          Date: tenant.waterBillUpdatedAt ? new Date(tenant.waterBillUpdatedAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          Method: 'Rent + water',
          Reference: 'Monthly total',
          Period: new Date(`${exportMonth}-01T00:00:00`).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
          Rent: rentAmount,
          Water: waterAmount,
          PaidStatus: paidStatus,
          OutstandingBalance: outstandingBalance,
        }
      })

    const rows: CsvLedgerRow[] = tenantMonthlyRows
    const totalCollected = rows.reduce((sum, row) => sum + Math.max(Number(row.Amount ?? 0) - Number(row.OutstandingBalance ?? 0), 0), 0)
    const totalOutstanding = rows.reduce((sum, row) => sum + Number(row.OutstandingBalance ?? 0), 0)

    const summaryRows: CsvLedgerRow[] = [
      {
        Type: 'Summary',
        Property: exportProperty,
        Unit: exportUnit,
        Tenant: 'Total collected this month',
        Amount: totalCollected,
        Date: '',
        Method: 'Summary',
        Reference: 'Total collected this month',
        Period: new Date(`${exportMonth}-01T00:00:00`).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
        Rent: 0,
        Water: 0,
        PaidStatus: 'Paid',
        OutstandingBalance: 0,
      },
      {
        Type: 'Summary',
        Property: exportProperty,
        Unit: exportUnit,
        Tenant: 'Total outstanding this month',
        Amount: totalOutstanding,
        Date: '',
        Method: 'Summary',
        Reference: 'Total outstanding this month',
        Period: new Date(`${exportMonth}-01T00:00:00`).toLocaleString('en-KE', { month: 'long', year: 'numeric' }),
        Rent: 0,
        Water: 0,
        PaidStatus: 'Unpaid',
        OutstandingBalance: totalOutstanding,
      },
    ]

    const csvRows = [
      'Type,Property,Unit,Tenant,Rent,Water,Monthly rent + water total,Paid status,Outstanding balance,Date,Method,Reference,Period',
      ...rows.map((row) => [
        row.Type,
        `"${String(row.Property).replaceAll('"', '""')}"`,
        `"${String(row.Unit).replaceAll('"', '""')}"`,
        `"${String(row.Tenant).replaceAll('"', '""')}"`,
        Number(row.Rent ?? 0),
        Number(row.Water ?? 0),
        Number(row.Amount ?? 0),
        `"${String(row.PaidStatus ?? 'Unpaid').replaceAll('"', '""')}"`,
        Number(row.OutstandingBalance ?? 0),
        row.Date,
        `"${String(row.Method).replaceAll('"', '""')}"`,
        `"${String(row.Reference).replaceAll('"', '""')}"`,
        `"${String(row.Period).replaceAll('"', '""')}"`,
      ].join(',')),
      ...summaryRows.map((row) => [
        row.Type,
        `"${String(row.Property).replaceAll('"', '""')}"`,
        `"${String(row.Unit).replaceAll('"', '""')}"`,
        `"${String(row.Tenant).replaceAll('"', '""')}"`,
        Number(row.Rent ?? 0),
        Number(row.Water ?? 0),
        Number(row.Amount ?? 0),
        `"${String(row.PaidStatus ?? 'Unpaid').replaceAll('"', '""')}"`,
        Number(row.OutstandingBalance ?? 0),
        row.Date,
        `"${String(row.Method).replaceAll('"', '""')}"`,
        `"${String(row.Reference).replaceAll('"', '""')}"`,
        `"${String(row.Period).replaceAll('"', '""')}"`,
      ].join(',')),
    ]
    const filename = exportProperty === 'All properties' ? `moha-rental-ledger-${exportMonth}.csv` : `moha-rental-ledger-${exportProperty}-${exportMonth}.csv`
    download(filename, csvRows.join('\n'))
  }

  const exportBackup = () => download(
    'moha-rental-backup.json',
    JSON.stringify({ exportedAt: new Date().toISOString(), tenants, properties, payments, expenses, applicants }, null, 2),
    'application/json'
  )

  const isPaid = (tenant: TenantRecord) => payments.some((payment) => payment.includes(tenant.property) && payment.includes(tenant.unit)) || directRentPayments.some((payment) => payment.property_name === tenant.property && payment.unit_name === tenant.unit && new Date(payment.transacted_at).toLocaleString('en-KE', { month: 'long', year: 'numeric' }) === new Date().toLocaleString('en-KE', { month: 'long', year: 'numeric' }))

  return (
    <section className="operations-view panel">
      <div className="section-view-heading">
        <div>
          <p className="eyebrow">Business operations</p>
          <h2>Operations center</h2>
          <p>Control collections, leasing, expenses, communications, and records from one place.</p>
        </div>
        <div className="operations-actions">
          <div className="compact-form" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="form-field" style={{ minWidth: 150, marginBottom: 0 }}>
              <span>Month</span>
              <input type="month" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)} />
            </label>
            <label className="form-field" style={{ minWidth: 180, marginBottom: 0 }}>
              <span>Property</span>
              <select value={exportProperty} onChange={(event) => { setExportProperty(event.target.value); setExportUnit('All units') }}>
                {availableExportProperties.map((property) => <option key={property} value={property}>{property}</option>)}
              </select>
            </label>
            <label className="form-field" style={{ minWidth: 150, marginBottom: 0 }}>
              <span>Unit</span>
              <select value={exportUnit} onChange={(event) => setExportUnit(event.target.value)}>
                {availableExportUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </label>
          </div>
          <button className="filter-button" onClick={exportLedger}><Download size={16} /> Export CSV</button>
          <button className="primary-button" onClick={exportBackup}><FileText size={16} /> Backup data</button>
        </div>
      </div>

      <div className="operations-metrics">
        <article>
          <span><CircleDollarSign size={18} /></span>
          <small>Recorded income</small>
          <strong>KSh {totalCollected.toLocaleString()}</strong>
        </article>
        <article>
          <span><TrendingUp size={18} /></span>
          <small>Recorded expenses</small>
          <strong>KSh {totalExpenses.toLocaleString()}</strong>
        </article>
        <article>
          <span><WalletCards size={18} /></span>
          <small>Net cash flow</small>
          <strong>KSh {(totalCollected - totalExpenses).toLocaleString()}</strong>
        </article>
      </div>

      <div className="operations-grid">
        <article className="operation-card rent-status">
          <div className="operation-heading">
            <div>
              <p className="eyebrow">Collections</p>
              <h3>Rent due tracker</h3>
            </div>
            <ReceiptText size={19} />
          </div>

          {tenants.length ? (
            <div className="due-list">
              {visibleRentTrackerTenants.map((tenant) => {
                const paid = isPaid(tenant)
                const dueDate = getNextMonthlyRentDueDate(tenant.movedIn).toLocaleDateString('en-KE', { month: 'long', day: 'numeric', year: 'numeric' })
                const message = buildRentWhatsAppMessage({ workspaceName, tenant, rent: tenant.rent, waterBill: tenant.waterBill ?? '0', paymentDetails, dueDate })
                const phone = normalizeWhatsAppPhone(tenant.phone)
                return (
                  <div key={tenant.property + '-' + tenant.unit} className="rent-tracker-row">
                    <span>
                      <strong>{tenant.name}</strong>
                      <small>{tenant.property} · {getTenantUnitLabel(tenant)} · KSh {tenant.rent}</small>
                    </span>
                    <span className={'payment-state ' + (paid ? 'paid' : 'due')}>{paid ? 'Paid' : 'Due'}</span>
                    <div className="rent-tracker-actions">
                      <button type="button" className="reminder-button" disabled={!phone} title={phone ? 'Send complete rent details to the registered tenant number' : 'Add a valid tenant phone number first'} onClick={() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer')}>WhatsApp</button>
                      <button type="button" className="receipt-button" onClick={() => onGenerateInvoice(tenant)}>Invoice</button>
                    </div>
                  </div>
                )
              })}
              {tenants.length > operationsPageSize && <Pagination page={Math.min(rentTrackerPage, rentTrackerPageCount)} pageCount={rentTrackerPageCount} onPageChange={setRentTrackerPage} />}
            </div>
          ) : (
            <p className="empty-state">No tenant records yet.</p>
          )}
        </article>

        <article className="operation-card">
          <div className="operation-heading">
            <div>
              <p className="eyebrow">Expenses</p>
              <h3>Expense & profit report</h3>
            </div>
            <TrendingUp size={19} />
          </div>

          <form className="compact-form" onSubmit={(event) => {
            event.preventDefault()
            onAddExpense({
              id: 'expense-' + Date.now(),
              category: expenseForm.category,
              property: expenseForm.property || 'Portfolio',
              amount: Number(expenseForm.amount),
              date: expenseForm.date,
              note: expenseForm.note,
            })
            setExpenseForm({ category: 'Repairs', property: '', amount: '', date: new Date().toISOString().slice(0, 10), note: '' })
          }}>
            <select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>
              <option>Repairs</option>
              <option>Utilities</option>
              <option>Cleaning</option>
              <option>Security</option>
              <option>Administration</option>
              <option>Other</option>
            </select>
            <select value={expenseForm.property} onChange={(event) => setExpenseForm({ ...expenseForm, property: event.target.value })}>
              <option value="">Portfolio-wide</option>
              {properties.map((property) => <option key={property.name} value={property.name}>{property.name}</option>)}
            </select>
            <input required type="number" min="0" placeholder="Amount (KSh)" value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} />
            <input required type="date" value={expenseForm.date} onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })} />
            <input placeholder="Note (optional)" value={expenseForm.note} onChange={(event) => setExpenseForm({ ...expenseForm, note: event.target.value })} />
            <button className="save-settings" type="submit"><Plus size={14} /> Add expense</button>
          </form>

          <div className="mini-ledger">
            {visibleExpenses.map((expense) => (
              <div key={expense.id} className="mini-ledger-row">
                <span>
                  <strong>{expense.category}</strong>
                  <small>{expense.property} · {expense.date}</small>
                  {expense.paid && <span className="expense-paid-state"><CheckCircle2 size={13} /> Paid</span>}
                </span>
                <strong>KSh {expense.amount.toLocaleString()}</strong>
                <div className="applicant-actions expense-actions">
                  <button type="button" className={expense.paid ? 'expense-paid-action' : 'expense-complete-action'} onClick={() => onToggleExpensePaid?.(expense.id)}>{expense.paid ? 'Mark as unpaid' : 'Mark as done'}</button>
                  <button type="button" onClick={() => onEditExpense?.(expense)}>Edit</button>
                  <button type="button" onClick={() => onDeleteExpense?.(expense.id)}>Delete</button>
                </div>
              </div>
            ))}
            {expenses.length === 0 && <p className="empty-state">No expenses recorded yet.</p>}
          </div>
          {expenses.length > operationsPageSize && <Pagination page={Math.min(expensePage, expensePageCount)} pageCount={expensePageCount} onPageChange={setExpensePage} />}
        </article>

        <article className="operation-card leasing-card">
          <div className="operation-heading">
            <div>
              <p className="eyebrow">Leasing</p>
              <h3>Vacancy pipeline</h3>
            </div>
            <Home size={19} />
          </div>

          <form className="compact-form" onSubmit={(event) => {
            event.preventDefault()
            onAddApplicant({ id: 'applicant-' + Date.now(), ...applicantForm })
            setApplicantForm({ name: '', phone: '', property: '', unit: '', stage: 'Viewing' })
          }}>
            <input required placeholder="Applicant name" value={applicantForm.name} onChange={(event) => setApplicantForm({ ...applicantForm, name: event.target.value })} />
            <input required type="tel" placeholder="Phone number" value={applicantForm.phone} onChange={(event) => setApplicantForm({ ...applicantForm, phone: event.target.value })} />
            <select required value={applicantForm.property} onChange={(event) => setApplicantForm({ ...applicantForm, property: event.target.value })}>
              <option value="">Select property</option>
              {properties.map((property) => <option key={property.name} value={property.name}>{property.name}</option>)}
            </select>
            <input required placeholder="Preferred unit" value={applicantForm.unit} onChange={(event) => setApplicantForm({ ...applicantForm, unit: event.target.value })} />
            <select value={applicantForm.stage} onChange={(event) => setApplicantForm({ ...applicantForm, stage: event.target.value as ApplicantRecord['stage'] })}>
              <option>Viewing</option>
              <option>Applied</option>
              <option>Approved</option>
              <option>Moved in</option>
            </select>
            <button className="save-settings" type="submit"><UserPlus size={14} /> Add applicant</button>
          </form>

          <div className="mini-ledger">
            {visibleApplicants.map((applicant) => (
              <div key={applicant.id} className="applicant-row">
                <span>
                  <strong>{applicant.name}</strong>
                  <small>{applicant.property} · {applicant.unit} · {applicant.phone}</small>
                </span>
                <span className="pipeline-stage">{applicant.stage}</span>
                <div className="applicant-actions">
                  {applicant.stage === 'Viewing' && <button onClick={() => onApplicantAction?.(applicant.id, 'schedule')}>Schedule</button>}
                  {applicant.stage !== 'Moved in' && <button onClick={() => onApplicantAction?.(applicant.id, 'approve')}>Approve</button>}
                  <button onClick={() => onApplicantAction?.(applicant.id, 'reject')}>Remove</button>
                </div>
              </div>
            ))}
            {applicants.length === 0 && <p className="empty-state">No applicants yet.</p>}
          </div>
          {applicants.length > operationsPageSize && <Pagination page={Math.min(applicantPage, applicantPageCount)} pageCount={applicantPageCount} onPageChange={setApplicantPage} />}
        </article>
      </div>

      <div className="operations-note">
        <ShieldCheck size={17} />
        <span><strong>Access & records</strong> Role-based user access is managed in Settings. CSV exports and JSON backups are created on your device; restore/import can be added when you choose a central database.</span>
      </div>
    </section>
  )
}

function TenantStatementPage({ tenant, workspaceName, propertyGroup, statement, onBack, onSendReminder }: { tenant: TenantRecord; workspaceName: string; propertyGroup: string; statement: { amountDue: number; totalPaid: number; balance: number; history: Array<{ label: string; amount: number; date: string; method: string }> }; onBack: () => void; onSendReminder: (message?: string) => void }) {
  const exportStatement = () => {
    const rows = [
      'Tenant statement',
      `Workspace: ${workspaceName}`,
      `Property: ${tenant.property}`,
      `Unit: ${getTenantUnitLabel(tenant)}`,
      `Tenant: ${tenant.name}`,
      `Current rent due: KSh ${statement.amountDue.toLocaleString()}`,
      `Total paid: KSh ${statement.totalPaid.toLocaleString()}`,
      `Outstanding: KSh ${statement.balance.toLocaleString()}`,
      '',
      'Payment history',
      ...statement.history.map(item => `${item.date} | ${item.label} | ${item.method} | KSh ${item.amount.toLocaleString()}`),
    ]
    const blob = new Blob([rows.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${tenant.name.toLowerCase().replace(/\s+/g, '-')}-statement.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return <main className="tenant-portal-shell">
    <section className="tenant-portal-content">
      <header className="tenant-portal-header">
        <div className="tenant-resident-identity">
          <span className="tenant-resident-avatar">{tenant.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</span>
          <div>
            <p className="eyebrow">Resident account</p>
            <h2>{tenant.name}</h2>
            <p className="tenant-resident-location"><Building2 size={14} /> {tenant.property} <span>·</span> Unit {getTenantUnitLabel(tenant)}</p>
          </div>
        </div>
        <button className="tenant-logout-button" type="button" aria-label="Back to tenant sign in" onClick={onBack}><ArrowUpRight size={15} className="tenant-back-icon" /><span>Back to sign in</span></button>
      </header>

      <div className="tenant-portal-summary panel">
        <div className="panel-heading">
          <div><p className="eyebrow">Rent account</p><h2>{workspaceName}</h2></div>
          <span className="tenant-property-chip"><Building2 size={14} /> {propertyGroup}</span>
        </div>
        <div className={`tenant-balance-banner ${statement.balance > 0 ? 'has-balance' : 'settled'}`}>
          <div>
            <small>{statement.balance > 0 ? 'OUTSTANDING BALANCE' : 'ACCOUNT STATUS'}</small>
            <strong>{statement.balance > 0 ? `KSh ${statement.balance.toLocaleString()}` : 'You are all caught up'}</strong>
            <span>{statement.balance > 0 ? `For ${tenant.property} · Unit ${getTenantUnitLabel(tenant)}` : `No outstanding rent for ${tenant.property}`}</span>
          </div>
          <span className="tenant-balance-status">{statement.balance > 0 ? 'Payment due' : 'Paid in full'}</span>
        </div>
        <div className="health-grid">
          <article><span className="health-icon collection"><CircleDollarSign size={18} /></span><div><strong>KSh {statement.amountDue.toLocaleString()}</strong><small>Monthly rent</small></div></article>
          <article><span className="health-icon vacancy"><FileText size={18} /></span><div><strong>KSh {statement.totalPaid.toLocaleString()}</strong><small>Total paid</small></div></article>
          <article><span className="health-icon lease"><CalendarDays size={18} /></span><div><strong>{tenant.leaseEnd ? new Date(`${tenant.leaseEnd}T00:00:00`).toLocaleDateString('en-KE', { month: 'short', year: 'numeric' }) : 'Active'}</strong><small>Lease end</small></div></article>
        </div>
      </div>

      <div className="tenant-portal-grid">
        <article className="panel tenant-portal-card tenant-account-card">
          <div className="panel-heading"><div><p className="eyebrow">Account</p><h2>Rent summary</h2></div></div>
          <div className="due-list">
            <div><span><strong>{tenant.property}</strong><small>Property</small></span><span className="payment-state paid">{getTenantUnitLabel(tenant)}</span></div>
            <div><span><strong>{tenant.status}</strong><small>Status</small></span><span className="payment-state due">{tenant.leaseEnd ? `Lease ends ${tenant.leaseEnd}` : 'Active'}</span></div>
          </div>
          <div className="tenant-portal-actions">
            <button className="primary-button" type="button" onClick={() => onSendReminder()}>Send reminder</button>
            <button className="filter-button" type="button" onClick={exportStatement}>Download statement</button>
          </div>
        </article>

        <article className="panel tenant-portal-card tenant-history-card">
          <div className="panel-heading"><div><p className="eyebrow">Payments</p><h2>Payment history</h2><p className="tenant-history-caption">Your recorded rent payments</p></div><span className="tenant-history-count">{statement.history.length} records</span></div>
          <div className="mini-ledger">
            {statement.history.length ? statement.history.map((item, index) => <div key={`${item.date}-${item.label}-${index}`}><span><strong>KSh {item.amount.toLocaleString()}</strong><small>{item.method} · {item.date}</small></span><span className="payment-state paid">{item.label}</span></div>) : <p className="overview-empty">No payment history yet.</p>}
          </div>
        </article>
      </div>
    </section>
  </main>
}

function TenantPublicLoginPage({ darkMode, workspaceName, tenantList, tenantPortalForm, tenantPortalError, onTenantPortalFormChange, onTenantPortalSubmit, onBackToHome }: { darkMode: boolean; workspaceName: string; tenantList: TenantRecord[]; tenantPortalForm: { email: string; portalCode: string }; tenantPortalError: string; onTenantPortalFormChange: (key: 'email' | 'portalCode', value: string) => void; onTenantPortalSubmit: (event: FormEvent<HTMLFormElement>) => void; onBackToHome: () => void }) {
  const tenantHeroPhoto = 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1500&q=85'

  return <main className={`tenant-public-shell ${darkMode ? 'dark' : ''}`}>
    <section className="tenant-public-wrap" aria-labelledby="tenant-public-title">
      <aside className="tenant-public-brand">
        <div className="tenant-public-brand-header">
          <span className="tenant-public-logo" aria-hidden="true"><MohaLogo size={32} /></span>
          <div>
            <p className="tenant-public-kicker">RESIDENT PORTAL</p>
            <h2>{workspaceName}</h2>
          </div>
        </div>

        <div className="tenant-public-photo-frame">
          <img className="tenant-public-photo" src={tenantHeroPhoto} alt="Resident reviewing a rental property statement" />
          <div className="tenant-public-photo-shade" />
          <div className="tenant-public-photo-caption">
            <span>RESIDENT ACCESS</span>
            <strong>Pay rent online</strong>
          </div>
        </div>
      </aside>

      <div className="tenant-public-card">
        <div className="tenant-public-card-header">
          <p className="login-kicker">TENANT PORTAL</p>
          <button className="tenant-public-back" type="button" onClick={onBackToHome}>Portal home</button>
        </div>

        <h1 id="tenant-public-title">Resident sign in<span>.</span></h1>
        <p className="login-copy">Access your secure rent dashboard and stay up to date with your property account.</p>

        <form className="login-form" onSubmit={onTenantPortalSubmit}>
          <label className="login-field"><span>Tenant email</span><input required type="email" value={tenantPortalForm.email} onChange={(event) => onTenantPortalFormChange('email', event.target.value)} placeholder="tenant@example.com" /></label>
          <label className="login-field"><span>Portal code</span><input required value={tenantPortalForm.portalCode} onChange={(event) => onTenantPortalFormChange('portalCode', event.target.value)} placeholder="Use the code shared by your landlord" /></label>
          {tenantPortalError && <p className="login-error" role="alert">{tenantPortalError}</p>}
          <button className="login-button" type="submit" style={{ width: '100%' }} disabled={tenantList.length === 0}>Open my rent statement</button>
        </form>

        <div className="login-note"><span className="login-note-dot" />Private tenant access for resident statements and rent reminders.</div>
      </div>
    </section>
  </main>
}

function RoleIllustration({ role, compact = false }: { role: 'Landlord' | 'Administrator' | 'Caretaker' | 'Tenant'; compact?: boolean }) {
  const uid = useId().replace(/:/g, '')
  const color = role === 'Landlord' ? '#f4c76e' : role === 'Administrator' ? '#8aa6ff' : role === 'Caretaker' ? '#d7a967' : '#82c5cf'
  const accent = role === 'Landlord' ? '#17483d' : role === 'Administrator' ? '#1f2d4e' : role === 'Caretaker' ? '#4a5f3a' : '#31586b'
  const className = compact ? 'role-art compact' : 'role-art'
  const landlordBgId = `landlord-bg-${uid}`
  const adminBgId = `admin-bg-${uid}`
  const caretakerBgId = `caretaker-bg-${uid}`

  if (role === 'Landlord') {
    return <svg className={className} viewBox="0 0 160 120" aria-hidden="true" role="img">
      <defs>
        <linearGradient id={landlordBgId} x1="0" x2="1">
          <stop offset="0%" stopColor="#e7f4ea" />
          <stop offset="100%" stopColor="#f8e7b9" />
        </linearGradient>
      </defs>
      <rect x="14" y="18" width="132" height="84" rx="18" fill={`url(#${landlordBgId})`} />
      <path d="M36 62L80 30L124 62" fill="none" stroke={accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="42" y="62" width="76" height="32" rx="8" fill={accent} />
      <rect x="58" y="68" width="18" height="26" rx="4" fill="#edf7ee" />
      <rect x="84" y="68" width="18" height="26" rx="4" fill="#edf7ee" />
      <circle cx="80" cy="42" r="12" fill={color} />
      <path d="M64 50c0-9 7-16 16-16s16 7 16 16v10H64V50Z" fill={color} opacity="0.92" />
      <rect x="22" y="92" width="116" height="8" rx="4" fill={accent} opacity="0.18" />
    </svg>
  }

  if (role === 'Administrator') {
    return <svg className={className} viewBox="0 0 160 120" aria-hidden="true" role="img">
      <defs>
        <linearGradient id={adminBgId} x1="0" x2="1">
          <stop offset="0%" stopColor="#dfeaff" />
          <stop offset="100%" stopColor="#e7f8ff" />
        </linearGradient>
      </defs>
      <rect x="14" y="18" width="132" height="84" rx="18" fill={`url(#${adminBgId})`} />
      <rect x="30" y="36" width="96" height="52" rx="10" fill={accent} opacity="0.12" />
      <path d="M52 80V58M80 80V48M108 80V66" stroke={accent} strokeWidth="8" strokeLinecap="round" />
      <circle cx="52" cy="48" r="12" fill={color} />
      <path d="M114 40l14 12-14 12" fill="none" stroke={accent} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 96l30-14 22 14 30-18 24 18" fill="none" stroke={accent} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M96 32l16 0" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
  }

  if (role === 'Tenant') {
    return <svg className={className} viewBox="0 0 160 120" aria-hidden="true" role="img">
      <defs>
        <linearGradient id={caretakerBgId} x1="0" x2="1">
          <stop offset="0%" stopColor="#e3f3f3" />
          <stop offset="100%" stopColor="#e8edff" />
        </linearGradient>
      </defs>
      <rect x="14" y="18" width="132" height="84" rx="18" fill={`url(#${caretakerBgId})`} />
      <circle cx="70" cy="48" r="14" fill={color} />
      <path d="M44 91c2-20 12-30 26-30s24 10 26 30" fill={accent} />
      <circle cx="115" cy="72" r="16" fill="#fff" />
      <circle cx="115" cy="72" r="12" fill="none" stroke={accent} strokeWidth="4" />
      <path d="M115 84v9h8v-6h6v-6" fill="none" stroke={accent} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 96h100" stroke={accent} strokeWidth="5" strokeLinecap="round" opacity="0.2" />
    </svg>
  }

  return <svg className={className} viewBox="0 0 160 120" aria-hidden="true" role="img">
    <defs>
      <linearGradient id={caretakerBgId} x1="0" x2="1">
        <stop offset="0%" stopColor="#edf6e6" />
        <stop offset="100%" stopColor="#fce7c9" />
      </linearGradient>
    </defs>
    <rect x="14" y="18" width="132" height="84" rx="18" fill={`url(#${caretakerBgId})`} />
    <path d="M36 62L80 32L124 62" fill="none" stroke={accent} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="42" y="62" width="76" height="30" rx="8" fill={accent} />
    <path d="M58 62V50c0-9 7-16 16-16s16 7 16 16v12" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" />
    <circle cx="80" cy="45" r="10" fill={color} />
    <path d="M96 84l16-16 14 14" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M112 68h16v12h-16z" fill={color} opacity="0.9" />
    <path d="M40 90h80" stroke={accent} strokeWidth="6" strokeLinecap="round" opacity="0.4" />
  </svg>
}

function PublicLandlordSignupPage({ workspaceName, onBack }: { workspaceName: string; onBack: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '', plan: 'test' as PublicLandlordPlan })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    const phone = normalizeKenyanPhone(form.phone)
    if (!phone) { setError('Enter a valid Kenyan number with nine digits after +254.'); return }
    if (form.password.length < 8) { setError('Choose a password with at least 8 characters.'); return }
    if (form.password !== form.confirmPassword) { setError('The passwords do not match.'); return }
    if (!supabase) { setError('Online registration is not configured. Please contact the platform administrator.'); return }

    setSubmitting(true)
    const { data, error: signupError } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/landlord`,
        data: {
          public_landlord_signup: true,
          full_name: form.name.trim(),
          phone,
          requested_plan: form.plan,
        },
      },
    })
    setSubmitting(false)
    if (signupError) { setError(signupError.message); return }
    setSuccess(data.session
      ? 'Your request is submitted. Your account will remain locked until the Platform Administrator approves it.'
      : 'Check your email to confirm your address. Your account will remain locked until the Platform Administrator approves it.')
  }

  return <main className="login-shell landlord-signup-shell">
    <section className="login-card landlord-signup-card" aria-labelledby="landlord-signup-title">
      <div className="login-mobile-brand"><span className="login-logo"><MohaLogo size={20} /></span><span>{workspaceName}</span></div>
      <button type="button" className="signup-back-button" onClick={onBack}><ArrowUpRight size={15} /> Back to portal</button>
      <p className="login-kicker">LANDLORD REGISTRATION</p>
      <h1 id="landlord-signup-title">Start managing your properties<span>.</span></h1>
      <p className="login-copy">Create your account and choose a plan. A Platform Administrator must approve your account before you can access the system.</p>
      {success ? <div className="signup-success" role="status"><CheckCircle2 size={20} /><div><strong>Registration received</strong><p>{success}</p></div></div> : <form className="landlord-signup-form" onSubmit={submit}>
        <div className="landlord-signup-fields">
          <label className="login-field"><span>Full name</span><input required autoComplete="name" value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Your full name" /></label>
          <label className="login-field"><span>Email address</span><input required type="email" autoComplete="email" value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label>
          <label className="login-field"><span>WhatsApp number</span><div className="kenyan-phone-input"><span>+254</span><input required type="tel" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} value={getKenyanPhoneDigits(form.phone)} onChange={event => setForm(current => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 9) }))} placeholder="712345678" aria-label="WhatsApp number, nine digits after +254" /></div></label>
          <label className="login-field"><span>Password</span><input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} /></label>
          <label className="login-field"><span>Confirm password</span><input required type="password" minLength={8} autoComplete="new-password" value={form.confirmPassword} onChange={event => setForm(current => ({ ...current, confirmPassword: event.target.value }))} /></label>
        </div>
        <fieldset className="signup-plan-fieldset">
          <legend>Choose your plan</legend>
          <div className="signup-plan-grid">
            <button type="button" className={`signup-plan-option ${form.plan === 'test' ? 'selected' : ''}`} aria-pressed={form.plan === 'test'} onClick={() => setForm(current => ({ ...current, plan: 'test' }))}>
              <strong>Test</strong><b>Free · 1 month</b><small>Full system access, rent and tenant tools, invoices, reports, and maintenance.</small>
            </button>
            <button type="button" className={`signup-plan-option ${form.plan === 'silver_monthly' ? 'selected' : ''}`} aria-pressed={form.plan === 'silver_monthly'} onClick={() => setForm(current => ({ ...current, plan: 'silver_monthly' }))}>
              <strong>Silver Monthly</strong><b>KSh 500 / month</b><small>Properties, tenants, rent, water, payments, tenant portal, reminders, reports, and team access.</small>
            </button>
            <button type="button" className={`signup-plan-option ${form.plan === 'silver_yearly' ? 'selected' : ''}`} aria-pressed={form.plan === 'silver_yearly'} onClick={() => setForm(current => ({ ...current, plan: 'silver_yearly' }))}>
              <strong>Silver Yearly</strong><b>KSh 4,500 / year</b><small>All Silver features, priority support, advanced reports, and backup features.</small>
            </button>
          </div>
        </fieldset>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-button" type="submit" disabled={submitting}>{submitting ? 'Submitting request...' : 'Create landlord account'} <ArrowUpRight size={17} /></button>
        <p className="signup-approval-note">After email confirmation, your registration waits for administrator approval. Paid Silver subscriptions also require payment verification.</p>
      </form>}
    </section>
  </main>
}

function LandlordApprovalStatusPage({ workspaceName, registration, onRefresh, onBack }: { workspaceName: string; registration: { name: string; email: string; plan: PublicLandlordPlan | null; status: 'pending' | 'rejected' }; onRefresh: () => void; onBack: () => void }) {
  return <main className="login-shell landlord-approval-shell">
    <section className="login-card landlord-approval-card" aria-labelledby="landlord-approval-title">
      <div className="login-mobile-brand"><span className="login-logo"><MohaLogo size={20} /></span><span>{workspaceName}</span></div>
      <p className="login-kicker">LANDLORD REGISTRATION</p>
      <h1 id="landlord-approval-title">{registration.status === 'pending' ? 'Approval pending' : 'Registration not approved'}<span>.</span></h1>
      <p className="login-copy">{registration.status === 'pending'
        ? `Hello ${registration.name}, your account is waiting for Platform Administrator approval. You will get access after it is approved.`
        : 'Your registration was not approved. Contact the platform administrator if you think this is a mistake.'}</p>
      <div className="signup-approval-summary"><span>Email</span><strong>{registration.email}</strong><span>Selected plan</span><strong>{registration.plan === 'test' ? 'Test · Free for one month' : registration.plan === 'silver_monthly' ? 'Silver Monthly · KSh 500' : registration.plan === 'silver_yearly' ? 'Silver Yearly · KSh 4,500' : 'Not selected'}</strong></div>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={onBack}>Sign out</button>{registration.status === 'pending' && <button type="button" className="primary-button" onClick={onRefresh}>Check approval status</button>}</div>
    </section>
  </main>
}

function PortalHomePage({ workspaceName, onOpenRolePage, onOpenTenantPortal, onOpenLandlordSignup }: { workspaceName: string; onOpenRolePage: (role: 'Landlord' | 'Administrator' | 'Caretaker') => void; onOpenTenantPortal: () => void; onOpenLandlordSignup: () => void }) {
  const [activeContent, setActiveContent] = useState<'home' | 'portals' | 'about' | 'pricing' | 'contact'>('home')
  const [publicStats, setPublicStats] = useState<PublicPlatformStats | null>(null)
  const [displayedStats, setDisplayedStats] = useState<PublicPlatformStats>({ landlord_count: 0, tenant_count: 0, total_collected: 0 })
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState('')
  const [statsRetry, setStatsRetry] = useState(0)
  const isHome = activeContent === 'home'
  useEffect(() => {
    let active = true
    const loadPublicStats = async () => {
      setStatsLoading(true)
      setStatsError('')
      if (!supabase) {
        setStatsError('Live totals are temporarily unavailable.')
        setStatsLoading(false)
        return
      }
      try {
        const { data, error } = await supabase.rpc('get_public_platform_stats')
        if (error) throw new Error(error.message)
        const payload: unknown = Array.isArray(data) ? data[0] : data
        if (typeof payload !== 'object' || payload === null || !('landlord_count' in payload) || !('tenant_count' in payload) || !('total_collected' in payload)) {
          throw new Error('The public stats response was empty or incomplete.')
        }
        const row = payload
        const stats = {
          landlord_count: Number(row.landlord_count),
          tenant_count: Number(row.tenant_count),
          total_collected: Number(row.total_collected),
        }
        if (Object.values(stats).some(value => !Number.isFinite(value) || value < 0)) {
          throw new Error('The public stats response contained invalid totals.')
        }
        if (active) setPublicStats(stats)
      } catch {
        if (active) setStatsError('Live totals are temporarily unavailable.')
      } finally {
        if (active) setStatsLoading(false)
      }
    }
    void loadPublicStats()
    return () => { active = false }
  }, [statsRetry])
  useEffect(() => {
    if (!publicStats) return
    const target = publicStats
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setDisplayedStats(target)
      return
    }
    const duration = 1400
    let frame = 0
    let startTime = 0
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp
      const progress = Math.min((timestamp - startTime) / duration, 1)
      const easedProgress = 1 - (1 - progress) ** 3
      setDisplayedStats({
        landlord_count: Math.round(target.landlord_count * easedProgress),
        tenant_count: Math.round(target.tenant_count * easedProgress),
        total_collected: Math.round(target.total_collected * easedProgress),
      })
      if (progress < 1) frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [publicStats])
  const portals = [
    { title: 'Landlord', description: 'Manage properties, tenants, and rent collection.', icon: Building2, onSelect: () => onOpenRolePage('Landlord'), accent: 'landlord' },
    { title: 'Administrator', description: 'Manage workspace access, users, and settings.', icon: ShieldCheck, onSelect: () => onOpenRolePage('Administrator'), accent: 'administrator' },
    { title: 'Caretaker', description: 'Handle maintenance and day-to-day property care.', icon: Wrench, onSelect: () => onOpenRolePage('Caretaker'), accent: 'caretaker' },
    { title: 'Tenant', description: 'Existing tenants: view rent statements and payment history.', icon: Users, onSelect: onOpenTenantPortal, accent: 'tenant' },
  ]
  const showContent = (content: typeof activeContent) => {
    setActiveContent(content)
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return <main className="portal-home">
    <header className="portal-home-header">
      <div className="portal-home-brand">
        <span className="portal-home-logo"><MohaLogo size={42} /></span>
        <span><strong>MOHA</strong><small>{workspaceName}</small></span>
      </div>
      <nav className="portal-home-nav" aria-label="Public information">
        <button type="button" className={isHome ? 'active' : ''} aria-pressed={isHome} onClick={() => showContent('home')}>Home</button>
        <button type="button" className={activeContent === 'portals' ? 'active' : ''} aria-pressed={activeContent === 'portals'} onClick={() => showContent('portals')}>Portals</button>
        <button type="button" className={activeContent === 'about' ? 'active' : ''} aria-pressed={activeContent === 'about'} onClick={() => showContent('about')}>About Us</button>
        <button type="button" className={activeContent === 'pricing' ? 'active' : ''} aria-pressed={activeContent === 'pricing'} onClick={() => showContent('pricing')}>Pricing</button>
        <button type="button" className={activeContent === 'contact' ? 'active' : ''} aria-pressed={activeContent === 'contact'} onClick={() => showContent('contact')}>Contact</button>
      </nav>
      <button type="button" className="portal-home-header-signup" onClick={onOpenLandlordSignup}>Landlord sign up <ArrowUpRight size={15} /></button>
    </header>

    {isHome && <section className="portal-home-hero" aria-labelledby="portal-home-title">
      <div className="portal-home-copy">
        <p className="portal-home-eyebrow">YOUR RENTAL WORKSPACE</p>
        <h1 id="portal-home-title">A better way to care for every property.</h1>
        <p>Explore how Moha helps bring everyday rental management into one practical workspace.</p>
        <div className="portal-home-hero-actions">
          <button type="button" onClick={() => showContent('portals')}>Choose a portal <ArrowUpRight size={16} /></button>
          <button type="button" onClick={onOpenLandlordSignup}>Create landlord account</button>
        </div>
      </div>
      <div className="portal-home-image">
        <img src="https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1600&q=85" alt="Modern multi-storey residential apartments" />
        <span>Homes, managed with care.</span>
      </div>
    </section>}

    {isHome && <section className="portal-home-stats" aria-label="Moha platform totals">
      <div className="portal-home-stat">
        <span className="portal-home-stat-icon"><Building2 size={21} /></span>
        <div><strong aria-label={publicStats ? `${publicStats.landlord_count} landlords served` : 'Landlords served'}>
          <span aria-hidden="true">{publicStats ? displayedStats.landlord_count.toLocaleString('en-KE') : '—'}</span>
        </strong><small>Landlords served</small></div>
      </div>
      <div className="portal-home-stat">
        <span className="portal-home-stat-icon tenants"><Users size={21} /></span>
        <div><strong aria-label={publicStats ? `${publicStats.tenant_count} tenants managed` : 'Tenants managed'}>
          <span aria-hidden="true">{publicStats ? displayedStats.tenant_count.toLocaleString('en-KE') : '—'}</span>
        </strong><small>Tenants managed</small></div>
      </div>
      <div className="portal-home-stat">
        <span className="portal-home-stat-icon collected"><CircleDollarSign size={21} /></span>
        <div><strong aria-label={publicStats ? `KSh ${publicStats.total_collected.toLocaleString('en-KE')} total collected` : 'Total collected'}>
          <span aria-hidden="true">{publicStats ? `KSh ${displayedStats.total_collected.toLocaleString('en-KE')}` : '—'}</span>
        </strong><small>Total rent collected</small></div>
      </div>
      {statsError && <div className="portal-home-stats-message" role="status">{statsError}<button type="button" onClick={() => setStatsRetry(current => current + 1)}>Try again</button></div>}
      {statsLoading && <span className="portal-home-stats-loading" role="status">Loading live totals…</span>}
    </section>}

    {isHome && <section className="portal-home-overview" aria-labelledby="portal-home-overview-title">
      <div className="portal-home-section-heading">
        <div><p className="portal-home-eyebrow">A CLEARER WAY TO MANAGE</p><h2 id="portal-home-overview-title">Everything you need, in one place</h2></div>
        <button type="button" className="portal-home-text-link" onClick={() => showContent('about')}>Discover Moha <ArrowUpRight size={16} /></button>
      </div>
      <div className="portal-home-overview-grid">
        <article><span className="portal-home-overview-icon"><Building2 size={22} /></span><h3>Your properties, organized</h3><p>Keep units, occupancy, and resident details together in one clear workspace.</p></article>
        <article><span className="portal-home-overview-icon payments"><CircleDollarSign size={22} /></span><h3>Rent, made easier to track</h3><p>Review recorded payments and give residents access to their rent history.</p></article>
        <article><span className="portal-home-overview-icon operations"><ClipboardList size={22} /></span><h3>Daily work, connected</h3><p>Bring maintenance, team coordination, and property operations together.</p></article>
      </div>
      <div className="portal-home-overview-cta">
        <div><strong>Ready to see Moha in action?</strong><span>Choose the right portal or explore plans for your rental business.</span></div>
        <div><button type="button" className="portal-home-overview-secondary" onClick={() => showContent('pricing')}>View plans</button><button type="button" className="portal-home-overview-primary" onClick={() => showContent('portals')}>Explore portals <ArrowUpRight size={16} /></button></div>
      </div>
    </section>}

    {activeContent === 'portals' && <section className="portal-home-portals" id="portal-access" aria-labelledby="portal-home-portals-title">
      <div className="portal-home-section-heading">
        <div><p className="portal-home-eyebrow">PORTAL ACCESS</p><h2 id="portal-home-portals-title">Choose your portal</h2></div>
        <span>Secure access for every member of your property community</span>
      </div>
      <div className="portal-home-signup portal-home-signup-quick">
        <div><strong>New landlord? Get your first month free.</strong><span>Choose the free one-month Test plan when you register. Workspace access begins after admin approval.</span></div>
        <button type="button" className="portal-home-signup-button" onClick={onOpenLandlordSignup}>Get one month free <ArrowUpRight size={17} /></button>
      </div>
      <div className="portal-home-grid">
        {portals.map(({ title, description, icon: Icon, onSelect, accent }) => <button className={`portal-home-card ${accent}`} key={title} type="button" onClick={onSelect}>
          <span className="portal-home-card-icon"><Icon size={24} strokeWidth={1.8} /></span>
          <span className="portal-home-card-copy"><strong>{title}</strong><small>{description}</small></span>
          <LogIn className="portal-home-card-arrow" size={19} aria-hidden="true" />
        </button>)}
      </div>
      <p className="portal-home-tenant-note">Tenant access is for existing residents. Your landlord provides the email and portal code needed to sign in; tenant accounts are not created from this page.</p>
    </section>}

    {activeContent === 'about' && <section className="portal-home-information" id="why-moha" aria-labelledby="why-moha-title">
      <div className="portal-home-section-heading">
        <div><p className="portal-home-eyebrow">WHY MOHA RENTAL MANAGEMENT SYSTEM</p><h2 id="why-moha-title">Why choose Moha Rental Management System?</h2></div>
        <span>Tools for landlords, teams, and residents to stay organized.</span>
      </div>
      <div className="portal-home-benefits">
        <article><span className="portal-home-benefit-icon"><Building2 size={20} /></span><div><h3>Organize properties</h3><p>Keep property, unit, tenant, and occupancy details together in your workspace.</p></div></article>
        <article><span className="portal-home-benefit-icon"><CircleDollarSign size={20} /></span><div><h3>Track rent and payments</h3><p>Record rent activity, follow payment history, and share tenant statements.</p></div></article>
        <article><span className="portal-home-benefit-icon"><ClipboardList size={20} /></span><div><h3>Coordinate daily work</h3><p>Manage maintenance requests, expenses, applicants, and team access.</p></div></article>
        <article><span className="portal-home-benefit-icon"><Users size={20} /></span><div><h3>Keep residents informed</h3><p>Give existing tenants a portal for account details, statements, and payment history.</p></div></article>
      </div>
    </section>}

    {activeContent === 'about' && <section className="portal-home-about focused" id="about-moha" aria-labelledby="about-moha-title">
      <div className="portal-home-about-copy">
        <p className="portal-home-eyebrow">ABOUT MOHA RENTAL MANAGEMENT SYSTEM</p>
        <h2 id="about-moha-title">About Moha Rental Management System</h2>
        <p>Moha Rental Management System is a property-management workspace for landlords and their teams. It brings property records, tenant information, rent tracking, and everyday operations into one place, with a dedicated portal for residents.</p>
      </div>
      <div className="portal-home-purpose" id="moha-mission-vision">
        <article><span>OUR MISSION</span><h3>Make rental operations clearer and easier to manage.</h3><p>Help landlords and their teams organize essential property and tenant work with practical, accessible tools.</p></article>
        <article><span>OUR VISION</span><h3>A more connected rental experience.</h3><p>Support better communication and more organized property management for landlords, teams, and residents.</p></article>
      </div>
    </section>}

    {activeContent === 'pricing' && <section className="portal-home-pricing" id="pricing" aria-labelledby="pricing-title">
      <div className="portal-home-section-heading">
        <div><p className="portal-home-eyebrow">SIMPLE PLANS</p><h2 id="pricing-title">Pricing that grows with your rental business</h2></div>
        <span>Choose a plan during landlord registration. Paid subscriptions are activated after payment verification.</span>
      </div>
      <div className="portal-home-pricing-grid">
        <article className="portal-home-plan-card">
          <p className="portal-home-plan-label">TRY MOHA</p>
          <h3>Test Plan</h3>
          <div className="portal-home-plan-price">KSh 0 <span>/ 1 month</span></div>
          <p className="portal-home-plan-description">Try the full system free for one month.</p>
          <ul>
            <li>Properties, units, and tenant management</li>
            <li>Rent, water bills, and payment tracking</li>
            <li>Invoices, tenant portal, and WhatsApp reminders</li>
            <li>Maintenance, expenses, and monthly CSV reports</li>
          </ul>
          <button type="button" onClick={onOpenLandlordSignup}>Start free month <ArrowUpRight size={16} /></button>
        </article>
        <article className="portal-home-plan-card">
          <p className="portal-home-plan-label">FLEXIBLE BILLING</p>
          <h3>Silver Monthly</h3>
          <div className="portal-home-plan-price">KSh 500 <span>/ month</span></div>
          <p className="portal-home-plan-description">Full property management, billed monthly.</p>
          <ul>
            <li>Unlimited properties, units, and tenants</li>
            <li>Rent, water bills, and payment tracking</li>
            <li>Invoices, tenant portal, and WhatsApp reminders</li>
            <li>Maintenance, expenses, applicants, reports, and team access</li>
          </ul>
          <button type="button" onClick={onOpenLandlordSignup}>Register as landlord <ArrowUpRight size={16} /></button>
        </article>
        <article className="portal-home-plan-card featured">
          <span className="portal-home-plan-badge">BEST VALUE</span>
          <p className="portal-home-plan-label">SAVE KSh 1,500 VS MONTHLY</p>
          <h3>Silver Yearly</h3>
          <div className="portal-home-plan-price">KSh 4,500 <span>/ year</span></div>
          <p className="portal-home-plan-description">Everything in Silver Monthly, with annual extras.</p>
          <ul>
            <li>All Silver Monthly features</li>
            <li>12 months of system access</li>
            <li>Priority support</li>
            <li>Advanced reports and backup</li>
          </ul>
          <button type="button" onClick={onOpenLandlordSignup}>Register as landlord <ArrowUpRight size={16} /></button>
        </article>
      </div>
      <p className="portal-home-pricing-note">Access to a new landlord workspace begins after administrator approval. Silver plans require payment and administrator verification.</p>
    </section>}

    {activeContent === 'contact' && <section className="portal-home-contact" id="contact-moha" aria-labelledby="contact-moha-title">
      <div><p className="portal-home-eyebrow">CONTACT</p><h2 id="contact-moha-title">Questions about Moha?</h2><p>Get in touch for information about the platform or help choosing the right portal.</p></div>
      <div className="portal-home-contact-links">
        <a href="mailto:mohammedhussein3562@gmail.com"><strong>Email</strong><span>mohammedhussein3562@gmail.com</span></a>
        <a href="tel:0112800325"><strong>Phone</strong><span>0112 800 325</span></a>
      </div>
      <div className="portal-home-team" aria-labelledby="portal-home-team-title">
        <div className="portal-home-team-heading">
          <div><p className="portal-home-eyebrow">THE PEOPLE BEHIND MOHA</p><h3 id="portal-home-team-title">Our team</h3></div>
          <span>Here to make rental management work better for you.</span>
        </div>
        <div className="portal-home-team-grid">
          <article className="portal-home-team-card">
            <span className="portal-home-team-avatar" aria-hidden="true">HM</span>
            <div><h4>Hussein Mohamed</h4><p>Front &amp; Back End Developer</p></div>
          </article>
          <article className="portal-home-team-card">
            <span className="portal-home-team-avatar administrator" aria-hidden="true">MN</span>
            <div><h4>Mary Nduruchi</h4><p>Administrator</p></div>
          </article>
        </div>
      </div>
    </section>}

    <footer className="portal-home-footer">
      <div className="portal-home-footer-main">
        <div className="portal-home-footer-brand">
          <span className="portal-home-logo"><MohaLogo size={38} /></span>
          <div><strong>MOHA</strong><span>Rental Management System</span></div>
          <p>Practical tools to help landlords, teams, and residents stay organized.</p>
        </div>
        <nav className="portal-home-footer-nav" aria-label="Footer navigation">
          <strong>Explore</strong>
          <button type="button" onClick={() => showContent('home')}>Home</button>
          <button type="button" onClick={() => showContent('portals')}>Portals</button>
          <button type="button" onClick={() => showContent('about')}>About Us</button>
          <button type="button" onClick={() => showContent('pricing')}>Pricing</button>
          <button type="button" onClick={() => showContent('contact')}>Contact</button>
        </nav>
        <div className="portal-home-footer-contact">
          <strong>Get in touch</strong>
          <a href="mailto:mohammedhussein3562@gmail.com">mohammedhussein3562@gmail.com</a>
          <a href="tel:0112800325">0112 800 325</a>
          <button type="button" className="portal-home-footer-signup" onClick={onOpenLandlordSignup}>Create landlord account <ArrowUpRight size={15} /></button>
        </div>
      </div>
      <div className="portal-home-footer-bottom">
        <span>© {new Date().getFullYear()} Moha Rental Management System</span>
        <span>Simple, secure property operations</span>
      </div>
    </footer>
  </main>
}

function LoginView({ darkMode, workspaceName, authMessage, onOpenTenantPortal, onOpenRolePage, onOpenLandlordSignup }: { darkMode: boolean; workspaceName: string; authMessage: string; onOpenTenantPortal: () => void; onOpenRolePage: (role: 'Landlord' | 'Administrator' | 'Caretaker') => void; onOpenLandlordSignup: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(authMessage)
  const [loginVariant, setLoginVariant] = useState<'Landlord' | 'Administrator' | 'Caretaker'>(() => {
    if (typeof window === 'undefined') return 'Landlord'
    const currentPath = window.location.pathname
    if (currentPath === '/admin' || currentPath === '/administrator') return 'Administrator'
    if (currentPath === '/caretaker') return 'Caretaker'
    return 'Landlord'
  })
  const variantDetails = {
    Landlord: { title: 'Landlord', kicker: 'PROPERTY OWNER', summary: 'Monitor occupancy, collect rent, and manage your portfolio.', accent: 'landlord' },
    Administrator: { title: 'Administrator', kicker: 'SYSTEM ADMIN', summary: 'Configure users, roles, settings, and workspace access.', accent: 'administrator' },
    Caretaker: { title: 'Caretaker', kicker: 'ON-SITE CARE', summary: 'Track maintenance, unit health, and resident issues quickly.', accent: 'caretaker' },
  } as const
  const rolePhoto = {
    Landlord: 'https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1500&q=85',
    Administrator: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=1500&q=85',
    Caretaker: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1500&q=85',
  }[loginVariant]
  useEffect(() => { if (authMessage) setError(authMessage) }, [authMessage])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!supabase) { setError('Supabase is not configured for this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your hosting provider environment settings, then rebuild and redeploy.'); return }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: username.trim(), password })
    if (signInError) setError(signInError.message)
  }
  const selectedVariant = variantDetails[loginVariant]
  const handleLoginVariantChange = (role: 'Landlord' | 'Administrator' | 'Caretaker') => {
    setLoginVariant(role)
    onOpenRolePage(role)
  }
  return <main className={`login-shell ${darkMode ? 'dark' : ''}`}>
    <aside className={`login-aside ${selectedVariant.accent}`} aria-label={`${selectedVariant.title} sign-in`}>
      <div className="login-brand-lockup">
        <span className="login-brand-mark" aria-hidden="true"><MohaLogo size={26} /></span>
        <div className="login-brand-copy">
          <small>MOHA</small>
          <span>{workspaceName}</span>
        </div>
      </div>
      <div className="login-photo-frame">
        <img className="login-role-photo" src={rolePhoto} alt={loginVariant === 'Caretaker' ? 'Caretaker maintaining a property' : 'Landlord overseeing a rental property'} />
        <div className="login-photo-shade" />
        <div className="login-photo-caption">
          <span>{selectedVariant.kicker}</span>
          <strong>{selectedVariant.title}</strong>
        </div>
        <span className="login-photo-index">MOHA RENTAL MANAGEMENT</span>
      </div>
    </aside>
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-mobile-brand"><span className="login-logo"><MohaLogo size={20} /></span><span>{workspaceName}</span></div>
      <p className="login-kicker">SECURE WORKSPACE</p>
      <h1 id="login-title">Welcome back<span>.</span></h1>
      <p className="login-copy">Sign in to manage your properties, tenants, payments, and maintenance.</p>

      <div className="login-role-selector" aria-label="Select user role">
        {(['Landlord', 'Administrator', 'Caretaker'] as const).map((role) => (
          <button key={role} type="button" className={`login-role-tab ${loginVariant === role ? 'active' : ''}`} onClick={() => handleLoginVariantChange(role)}>
            <RoleIllustration role={role} compact />
            <span>{role}</span>
          </button>
        ))}
        <button type="button" className="login-role-tab login-tenant-tab" onClick={onOpenTenantPortal}>
          <RoleIllustration role="Tenant" compact />
          <span>Tenant</span>
        </button>
      </div>
      <p className="login-tenant-hint">Tenants sign in through their separate portal. Landlords can add tenants after signing in.</p>

      <form className="login-form" onSubmit={submit}>
        <label className="login-field"><span>Supabase email</span><input required type="email" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label className="login-field"><span>Password</span><input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-button" type="submit">Sign in as {selectedVariant.title} <ArrowUpRight size={17} /></button>
      </form>
      {loginVariant === 'Landlord' && <button type="button" className="login-signup-link" onClick={onOpenLandlordSignup}>New here? Create a landlord account</button>}
      <div className="login-note"><span className="login-note-dot" />{isSupabaseConfigured ? 'Your rental workspace is stored securely in Supabase.' : 'Access is managed by your system administrator.'}</div>
    </section>
  </main>
}

function PasswordRecoveryView({ darkMode, onSave }: { darkMode: boolean; onSave: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    if (password.length < 8) { setMessage('Use at least 8 characters for your password.'); return }
    if (password !== confirmPassword) { setMessage('The passwords do not match.'); return }
    setSaving(true)
    try {
      await onSave(password)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update the password.')
    } finally {
      setSaving(false)
    }
  }

  return <main className={`login-shell ${darkMode ? 'dark' : ''}`}>
    <section className="login-card" aria-labelledby="recovery-title">
      <p className="login-kicker">ACCOUNT SECURITY</p>
      <h1 id="recovery-title">Set a new password<span>.</span></h1>
      <p className="login-copy">Choose a new password for your Supabase account.</p>
      <form className="login-form" onSubmit={submit}>
        <label className="login-field"><span>New password</span><input required type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        <label className="login-field"><span>Confirm password</span><input required type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
        {message && <p className="login-error" role="alert">{message}</p>}
        <button className="login-button" type="submit" disabled={saving}>{saving ? 'Updating...' : 'Update password'}</button>
      </form>
    </section>
  </main>
}

function HelpCenterView() {
  const [query, setQuery] = useState('')
  const [openTopic, setOpenTopic] = useState<string | null>(null)

  const categories = [
    {
      label: 'Workspace sections',
      icon: '🧭',
      color: 'hc-blue',
      topics: [
        { question: 'What does the Overview screen show?', answer: 'The Overview page gives a live summary of your portfolio: occupancy, rent collection, key health cards, upcoming reminders, and quick operational metrics. It is the best place to understand the current status of your whole property portfolio at a glance.' },
        { question: 'What is the Properties section for?', answer: 'Use Properties to add new buildings, set unit counts, define rent amounts by bedroom type, and track occupancy across each property. This is where the structure of your portfolio is created and maintained.' },
        { question: 'How do I manage tenants?', answer: 'The Tenants page lets you add, edit, review, and track each tenant, including their unit, rent, lease dates, contact details, portal code, and payment status. It is the main place to manage all resident records.' },
        { question: 'What is the Tenant portal?', answer: 'The Tenant portal section gives you a resident-facing view of rent statements, reminders, payment history, and outstanding balances across all tenants. It helps you manage the tenant experience and keep communication organized.' },
        { question: 'What do Payments and Operations do?', answer: 'Payments stores incoming collections and rent history, while Operations handles expenses, applicant tracking, invoicing, exports, and backup records. Together they keep the business side of the portfolio running smoothly.' },
        { question: 'What is the Documents section?', answer: 'Documents stores invoice archives and supporting property records in one place. You can reopen previously generated invoices and keep your archive organized for day-to-day operations and audits.' },
      ],
    },
    {
      label: 'Getting started',
      icon: '🏠',
      color: 'hc-blue',
      topics: [
        { question: 'How do I add a property?', answer: 'Go to Properties and click Add property. Enter the property name and address, then add only the unit types that building has. You can use names such as Single room, Shop, Bedsitter, or 1 Bedroom; set each type’s unit count and monthly rent. Units are created automatically.' },
        { question: 'How do I add a tenant?', answer: 'Go to Tenants and click Add tenant. Select a property, pick an available vacant unit — the type and rent load automatically — then fill in the tenant details and lease end date.' },
        { question: 'How do I log in?', answer: 'Use the Supabase Auth email and password for your account. New staff receive an invitation email where they can set their password. You can change your password from the profile menu or request a reset link from Settings.' },
      ],
    },
    {
      label: 'Payments & Finance',
      icon: '💰',
      color: 'hc-green',
      topics: [
        { question: 'How do tenants pay rent by Paybill?', answer: 'Give the tenant the configured rent Paybill and the unique Paybill account reference shown on their invoice or tenant profile. After Safaricom confirms the payment, it appears automatically in Payments under Confirmed rent payments with the M-Pesa receipt number. Do not use the tenant National ID as the account reference.' },
        { question: 'How do I record a manual payment?', answer: 'Go to Payments and click Add payment. Select the property and unit — the tenant name and scheduled rent amount fill in automatically. Add the payment date, method, and receipt reference. Safaricom-confirmed Paybill rent appears separately in Confirmed rent payments.' },
        { question: 'How do I generate an invoice?', answer: 'Go to Tenants, find the tenant, and click the Invoice button on their row. The invoice shows rent plus water bill. You can print it, email it, or share it via WhatsApp.' },
        { question: 'How do I track expenses?', answer: 'Go to Operations → Expense & profit report. Select a category (Repairs, Utilities, etc.), choose a property or portfolio-wide, enter the amount, date, and an optional note.' },
      ],
    },
    {
      label: 'Maintenance',
      icon: '🔧',
      color: 'hc-orange',
      topics: [
        { question: 'How do I log a maintenance request?', answer: 'Go to Maintenance and click Add maintenance request. Select the maintenance type, describe the issue, choose the property, house or unit number, and set a priority level (High, Medium, Low).' },
        { question: 'How do I mark a request as done?', answer: 'Click any maintenance record to open its details. If it is still open, you will see a Mark as done button. Click it to close the request and move it to completed.' },
        { question: 'How are priorities color-coded?', answer: 'High priority shows a red dot, Medium shows orange, Low shows green, and completed requests show grey. Use High for urgent safety or water issues.' },
      ],
    },
    {
      label: 'Users & Settings',
      icon: '⚙️',
      color: 'hc-purple',
      topics: [
        { question: 'How do I create a team account?', answer: 'The Platform Administrator invites Landlords. Each Landlord can invite Caretakers from Settings → Team access. Caretakers cannot invite or manage accounts.' },
        { question: 'How do I change my password?', answer: 'Click your name in the top-right profile button, then select Change Password. Enter your new password and confirm. Changes take effect immediately.' },
        { question: 'How do I suspend or remove a user?', answer: 'Go to Settings → System access. Each user row has action buttons: ⏸ to suspend access, ▶️ to restore, and 🗑️ to permanently delete. You cannot delete your own account.' },
      ],
    },
    {
      label: 'Data & Storage',
      icon: '💾',
      color: 'hc-teal',
      topics: [
        { question: 'Will my data remain after refresh?', answer: 'Yes. All properties, units, tenants, payments, maintenance, documents, and expenses are saved in your browser automatically and persist across refreshes.' },
        { question: 'How do I back up my data?', answer: 'Go to Operations and click Backup data. This downloads a full JSON backup of your workspace to your device. Keep it safe — you can use it to restore records if needed.' },
        { question: 'How do I export payments as CSV?', answer: 'Go to Operations and click Export CSV. This downloads a spreadsheet with all recorded payments and expenses, ready to open in Excel or Google Sheets.' },
      ],
    },
  ]

  const allTopics = categories.flatMap(c => c.topics.map(t => ({ ...t, icon: c.icon, color: c.color })))
  const filteredTopics = query.trim()
    ? allTopics.filter(t => `${t.question} ${t.answer}`.toLowerCase().includes(query.toLowerCase()))
    : null

  return (
    <section className="help-center-view utility-view panel">
      {/* Hero */}
      <div className="help-hero">
        <div className="help-hero-icon"><LifeBuoy size={32} /></div>
        <div>
          <p className="eyebrow">Support</p>
          <h2>Help Center</h2>
          <p>Everything you need to manage your rental portfolio effectively.</p>
        </div>
      </div>

      {/* Search */}
      <label className="help-search-bar">
        <Search size={18} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search across all topics…"
        />
        {query && <button className="help-search-clear" onClick={() => setQuery('')}>×</button>}
      </label>

      {/* Search results */}
      {filteredTopics !== null ? (
        <div className="help-search-results">
          <p className="help-results-label">{filteredTopics.length} result{filteredTopics.length !== 1 ? 's' : ''} for "{query}"</p>
          {filteredTopics.length === 0
            ? <div className="help-empty"><LifeBuoy size={36} /><p>No answers found. Try different keywords.</p></div>
            : filteredTopics.map(topic => (
              <button
                key={topic.question}
                className={`help-topic-card ${openTopic === topic.question ? 'expanded' : ''}`}
                onClick={() => setOpenTopic(openTopic === topic.question ? null : topic.question)}
              >
                <span className={`help-topic-icon ${topic.color}`}>{topic.icon}</span>
                <div className="help-topic-body">
                  <strong>{topic.question}</strong>
                  {openTopic === topic.question && <p className="help-topic-answer">{topic.answer}</p>}
                </div>
                <ChevronDown size={16} className={openTopic === topic.question ? 'help-chevron open' : 'help-chevron'} />
              </button>
            ))
          }
        </div>
      ) : (
        /* Category grid */
        <div className="help-categories">
          {categories.map(cat => (
            <div className="help-category" key={cat.label}>
              <div className={`help-category-header ${cat.color}`}>
                <span className="help-category-emoji">{cat.icon}</span>
                <strong>{cat.label}</strong>
              </div>
              <div className="help-category-topics">
                {cat.topics.map(topic => (
                  <button
                    key={topic.question}
                    className={`help-topic-card ${openTopic === topic.question ? 'expanded' : ''}`}
                    onClick={() => setOpenTopic(openTopic === topic.question ? null : topic.question)}
                  >
                    <div className="help-topic-body">
                      <strong>{topic.question}</strong>
                      {openTopic === topic.question && <p className="help-topic-answer">{topic.answer}</p>}
                    </div>
                    <ChevronDown size={15} className={openTopic === topic.question ? 'help-chevron open' : 'help-chevron'} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Support strip */}
      <div className="support-strip">
        <div className="support-strip-icon"><LifeBuoy size={22} /></div>
        <div>
          <strong>Still need help?</strong>
          <span>Our support team is ready to assist with your workspace.</span>
        </div>
        <button className="primary-button" onClick={() => window.open('mailto:support@moharental.com', '_blank')}>
          Contact support <ArrowUpRight size={15} />
        </button>
      </div>
    </section>
  )
}

function AddModal({ type, properties, unitDetails, initialValues, onClose, onSave }: { type: ModalType; properties: PropertyRecord[]; unitDetails: Record<string, UnitRecord[]>; initialValues?: Record<string, string>; onClose: () => void; onSave: (values: Record<string, string>, sendPortalWhatsApp: boolean, unitMix: UnitMixRow[]) => void }) {
  const config = modalConfig[type]
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(type === 'tenant' ? { assignedDate: localDateString() } : {}), ...initialValues }))
  const [propertyMix, setPropertyMix] = useState<UnitMixRow[]>([])
  const [propertyMixError, setPropertyMixError] = useState('')
  const [portalCode] = useState(() => type === 'tenant' ? makeTenantPortalCode() : '')
  const [portalCodeCopied, setPortalCodeCopied] = useState(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (type === 'tenant') {
      const phone = normalizeKenyanPhone(values.phone)
      if (!phone) return
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
      onSave({ ...values, phone, portalCode }, submitter?.value === 'save-and-whatsapp', [])
      return
    }
    if (type === 'property') {
      const labels = propertyMix.map((item) => item.type.trim().toLocaleLowerCase())
      if (propertyMix.length === 0) {
        setPropertyMixError('Add at least one unit type for this property.')
        return
      }
      if (propertyMix.some((item) => !item.type.trim() || !item.count || !item.rent || Number(item.count) < 1 || Number(item.rent) < 0)) {
        setPropertyMixError('Enter a name, at least one unit, and a valid monthly rent for every type.')
        return
      }
      if (new Set(labels).size !== labels.length) {
        setPropertyMixError('Each unit type must have a different name.')
        return
      }
      setPropertyMixError('')
      onSave(values, false, propertyMix)
      return
    }
    onSave(values, false, [])
  }
  const availableUnits = type === 'tenant' ? (unitDetails[values.property] ?? []).filter((unit) => unit.status === 'Vacant') : []
  const propertyUnits = type === 'maintenance' || type === 'payment' ? (unitDetails[values.property] ?? []) : []
  const selectedPaymentUnit = type === 'payment' ? propertyUnits.find((unit) => unit.unit === values.houseNumber) : undefined

  const paymentMethods = [
    { value: 'Cash',          icon: '💵', label: 'Cash' },
    { value: 'M-Pesa',        icon: '📱', label: 'M-Pesa' },
    { value: 'Bank Transfer', icon: '🏦', label: 'Bank Transfer' },
  ]

  const referenceLabel: Record<string, string> = {
    'Cash':          'Receipt number (optional)',
    'M-Pesa':        'M-Pesa transaction code',
    'Bank Transfer': 'Bank reference / slip number',
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="add-modal" onSubmit={handleSubmit}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
      <p className="eyebrow">New record</p>
      <h2>{config.title}</h2>
      <p className="modal-description">{config.description}</p>
      {config.fields.map((field) => <label className="form-field" key={field.key}>
        <span>{field.key === 'leaseEnd' ? 'Lease end date' : field.key === 'reference' && values.paymentMethod ? referenceLabel[values.paymentMethod] ?? field.label : field.label}</span>
        {type === 'tenant' && field.key === 'phone'
          ? <div className="kenyan-phone-input"><span>+254</span><input required type="tel" inputMode="numeric" pattern="[0-9]{9}" maxLength={9} placeholder="712345678" aria-label="Tenant mobile number, nine digits after country code 254" value={getKenyanPhoneDigits(values.phone)} onChange={(event) => setValues((current) => ({ ...current, phone: event.target.value.replace(/\D/g, '').slice(0, 9) }))} /></div>
          : type === 'tenant' && field.key === 'assignedDate'
          ? <><input required type="date" value={values.assignedDate ?? localDateString()} onChange={(event) => setValues((current) => ({ ...current, assignedDate: event.target.value }))} /><small>First rent is due {getFirstRentDueDate(values.assignedDate ?? localDateString())?.toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) ?? '30 days after assignment'} (30 days after this date).</small></>
          : type === 'tenant' && field.key === 'portalCode'
          ? <><div className="portal-code-row"><input readOnly value={portalCode} aria-label="Generated tenant portal code" /><button type="button" className="portal-code-copy" aria-label="Copy tenant portal code" title="Copy tenant portal code" onClick={() => { void navigator.clipboard.writeText(portalCode).then(() => { setPortalCodeCopied(true); window.setTimeout(() => setPortalCodeCopied(false), 1800) }) }}><Copy size={15} /></button></div><small className="portal-code-help">Share this code with the tenant. It is separate from the M-Pesa Paybill account reference.</small>{portalCodeCopied && <small className="portal-code-copied" role="status">Portal code copied.</small>}</>
          : type === 'payment' && field.key === 'amount'
          ? <input required type="number" readOnly value={selectedPaymentUnit ? selectedPaymentUnit.rent.replace(/[^0-9.]/g, '') : ''} placeholder="Select a house or unit first" />
          : type === 'payment' && field.key === 'property'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, property: event.target.value, houseNumber: '', amount: '' }))}><option value="">Select a property</option>{properties.map((property) => <option key={property.name} value={property.name}>{property.name}</option>)}</select>
          : type === 'payment' && field.key === 'houseNumber'
          ? <><select required value={values[field.key] ?? ''} onChange={(event) => { const unit = propertyUnits.find((item) => item.unit === event.target.value); setValues((current) => ({ ...current, houseNumber: event.target.value, amount: unit?.rent.replace(/[^0-9.]/g, '') ?? '' })) }}><option value="">{values.property ? propertyUnits.length ? 'Select a house or unit' : 'No units listed' : 'Select a property first'}</option>{propertyUnits.map((unit) => <option key={unit.unit} value={unit.unit}>{unit.displayName || unit.unit} · {unit.type} · {unit.status}</option>)}</select>{selectedPaymentUnit && <small className="selected-tenant-hint">Tenant: {selectedPaymentUnit.tenant} · Amount: KSh {selectedPaymentUnit.rent.replace(/^KSh\s*/, '')}</small>}</>
          : type === 'payment' && field.key === 'paymentMethod'
          ? <div className="payment-method-group">
              {paymentMethods.map(method => (
                <button
                  key={method.value}
                  type="button"
                  className={`payment-method-btn ${values.paymentMethod === method.value ? 'active' : ''}`}
                  onClick={() => setValues(current => ({ ...current, paymentMethod: method.value, reference: '' }))}
                >
                  <span className="pmb-icon">{method.icon}</span>
                  <span className="pmb-label">{method.label}</span>
                </button>
              ))}
            </div>
          : type === 'payment' && field.key === 'reference'
          ? <input
              required={values.paymentMethod === 'M-Pesa' || values.paymentMethod === 'Bank Transfer'}
              type="text"
              placeholder={values.paymentMethod === 'M-Pesa' ? 'e.g. QWE123ABCD' : values.paymentMethod === 'Bank Transfer' ? 'e.g. TXN-20241001' : 'e.g. RCP-001 (optional)'}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          : type === 'maintenance' && field.key === 'maintenanceType'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Select a maintenance type</option><option value="Electrical repair">Electrical repair</option><option value="Plumbing repair">Plumbing repair</option><option value="Painting">Painting</option><option value="Carpentry">Carpentry</option><option value="Masonry">Masonry</option><option value="Appliance repair">Appliance repair</option><option value="Other">Other</option></select>
          : type === 'maintenance' && field.key === 'priority'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Select priority</option><option value="High">High</option><option value="Medium">Medium</option><option value="Low">Low</option></select>
          : type === 'maintenance' && field.key === 'property'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, property: event.target.value, houseNumber: '' }))}><option value="">Select a property</option>{properties.map((property) => <option key={property.name} value={property.name}>{property.name}</option>)}</select>
          : type === 'maintenance' && field.key === 'houseNumber'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, houseNumber: event.target.value }))}><option value="">{values.property ? propertyUnits.length ? 'Select a house or unit' : 'No units listed' : 'Select a property first'}</option>{propertyUnits.map((unit) => <option key={unit.unit} value={unit.unit}>{unit.displayName || unit.unit} · {unit.type} · {unit.status}</option>)}</select>
          : type === 'tenant' && field.key === 'property'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, property: event.target.value, unit: '' }))}><option value="">Select a property</option>{properties.map((property) => <option key={property.name} value={property.name}>{property.name}</option>)}</select>
          : type === 'tenant' && field.key === 'unit'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, unit: event.target.value }))}><option value="">{values.property ? availableUnits.length ? 'Select a vacant unit' : 'No vacant units' : 'Select a property first'}</option>{availableUnits.map((unit) => <option key={unit.unit} value={unit.unit}>{unit.displayName || unit.unit} · {unit.type} · {unit.rent}</option>)}</select>
          : field.key === 'unitType'
          ? <select required value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Select unit type</option><option value="Bedsitter">Bedsitter</option><option value="1 Bedroom">1 Bedroom</option><option value="2 Bedroom">2 Bedroom</option></select>
          : <input required type={field.type ?? 'text'} placeholder={field.placeholder} value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
        }
      </label>)}
      {type === 'property' && <section className="property-unit-mix" aria-labelledby="property-unit-mix-title">
        <div className="property-unit-mix-heading">
          <div><strong id="property-unit-mix-title">Unit types</strong><p>Use any types this property has, such as Single room, Shop, Bedsitter, or 1 Bedroom.</p></div>
          <button type="button" className="property-unit-add" onClick={() => { setPropertyMix((current) => [...current, { type: '', count: '1', rent: '' }]); setPropertyMixError('') }}><Plus size={15} /> Add type</button>
        </div>
        {propertyMix.length === 0 && <p className="property-unit-empty">No unit types added yet.</p>}
        {propertyMix.map((item, index) => <div className="property-unit-row" key={index}>
          <label><span>Unit type</span><input required maxLength={40} placeholder="e.g. Single room" value={item.type} onChange={(event) => setPropertyMix((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, type: event.target.value } : row))} /></label>
          <label><span>Number of units</span><input required min="1" step="1" type="number" inputMode="numeric" value={item.count} onChange={(event) => setPropertyMix((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, count: event.target.value } : row))} /></label>
          <label><span>Monthly rent (KSh)</span><input required min="0" step="0.01" type="number" inputMode="decimal" placeholder="e.g. 8000" value={item.rent} onChange={(event) => setPropertyMix((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, rent: event.target.value } : row))} /></label>
          <button type="button" className="property-unit-remove" aria-label={`Remove unit type ${item.type || index + 1}`} onClick={() => { setPropertyMix((current) => current.filter((_, rowIndex) => rowIndex !== index)); setPropertyMixError('') }}>Remove</button>
        </div>)}
        {propertyMixError && <p className="property-unit-error" role="alert">{propertyMixError}</p>}
      </section>}
      <div className="modal-actions">
        <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
        {type === 'tenant' ? <>
          <button type="submit" className="cancel-button" name="submitAction" value="save">Save tenant</button>
          <button type="submit" className="primary-button" name="submitAction" value="save-and-whatsapp"><MessageCircle size={16} /> Save &amp; WhatsApp</button>
        </> : <button type="submit" className="primary-button"><Plus size={16} /> Save {type}</button>}
      </div>
    </form>
  </div>
}

function AccessDeniedView({ section }: { section: string }) {
  return (
    <section className="access-denied-view panel">
      <div className="access-denied-icon">🔒</div>
      <h2>Access restricted</h2>
      <p>You don't have permission to access <strong>{section}</strong>.</p>
      <p>Contact your Administrator if you need access to this section.</p>
    </section>
  )
}

export default App
