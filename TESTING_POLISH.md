# ClearRoute Testing & Polish Prompt

Using the ClearRoute Feature Specification and Technical Requirements as your reference, perform comprehensive testing and polish across the entire application. This is the final phase before beta launch.

## PHASE 1: TESTING STRATEGY

### Test Environment Setup
- Use Supabase sandbox/test environment (never test with live data)
- Create test user accounts for each role: Admin, Manager, Field Worker
- Seed test data: 10 customers, 5 routes, 20 invoices (various statuses), 5 expenses

### Testing Types to Implement

UNIT TESTING
- Test all utility functions (date formatting, currency formatting, calculations)
- Test VAT calculation logic (0%, 5%, 20% rates)
- Test invoice total calculations
- Test route optimization algorithms
- Use Jest or Vitest

INTEGRATION TESTING
- Test Supabase database operations (CRUD for all tables)
- Test Edge Function inputs/outputs
- Test API key configurations and environment variables

END-TO-END TESTING (Playwright or Cypress)
Critical user journeys to test:
1. User registration and login flow
2. Create customer → add to route → create invoice → record payment
3. Route execution workflow (start route → complete jobs → finish route)
4. Invoice anomaly detection triggers
5. Email sending flow
6. CSV import with duplicate detection

## PHASE 2: FUNCTIONAL TESTING CHECKLIST

### Authentication
- [ ] Login with valid credentials works
- [ ] Login with invalid credentials shows error
- [ ] Logout clears session
- [ ] Role-based routing enforced (Field Worker can't access /settings)
- [ ] Session timeout after inactivity

### Customers
- [ ] Add new customer with all fields
- [ ] Edit existing customer
- [ ] Delete customer (with confirmation)
- [ ] Search customers by name/address/postcode
- [ ] Customer CSV import works end-to-end
- [ ] Duplicate detection during import

### Routes
- [ ] Create new route
- [ ] Add customers as stops to route
- [ ] Reorder stops via up/down buttons
- [ ] Remove stop from route
- [ ] Assign route to worker
- [ ] Route optimization runs (geographic, AI, predictive)
- [ ] Accept/reject optimization suggestions

### Route Execution (Field Worker)
- [ ] View assigned routes
- [ ] Start route → status changes to in_progress
- [ ] Mark stop as travelling → arrived → completed
- [ ] Skip stop with reason
- [ ] Complete route → status changes to completed
- [ ] Actual times recorded vs estimates

### Invoices
- [ ] Create invoice with line items
- [ ] VAT calculates correctly at all rates
- [ ] Edit draft invoice
- [ ] Send invoice (generates PDF, sends email)
- [ ] Record payment (manual)
- [ ] Mark invoice as paid
- [ ] Invoice anomaly detection flags issues
- [ ] Generate invoice PDF with company branding

### GoCardless
- [ ] Connect GoCardless account
- [ ] Create mandate for customer
- [ ] Initiate payment collection
- [ ] Webhook processes payment confirmation
- [ ] Failed payment handling

### Expenses
- [ ] Add expense with all fields
- [ ] Receipt photo upload works
- [ ] OCR extracts data from receipt
- [ ] AI suggests category
- [ ] Edit/delete expense

### Payments
- [ ] Record payment against invoice
- [ ] Payment reduces outstanding balance
- [ ] Full payment marks invoice as paid
- [ ] Partial payment tracking

### Reports
- [ ] P&L report calculates correctly
- [ ] VAT return calculates correctly (all 9 boxes)
- [ ] Route performance shows accurate data
- [ ] Export to CSV/Excel works
- [ ] Date range filters work

### AI Features
- [ ] AI Assistant responds to queries
- [ ] Cash flow forecast generates
- [ ] Scheduling suggestions appear
- [ ] Churn scores calculate
- [ ] Customer communications generate

### Integrations
- [ ] Stripe payment link generation
- [ ] Xero sync works
- [ ] QuickBooks sync works
- [ ] Open Banking connects and imports transactions
- [ ] Companies House lookup works
- [ ] VAT number validation works

### Company Settings
- [ ] Save company details
- [ ] Upload logo (appears on invoices/PDFs)
- [ ] Edit email templates
- [ ] Invoice number sequence works

### Notifications
- [ ] Notifications appear for risk events
- [ ] Mark as read works
- [ ] Real-time updates via Supabase

### Mobile/PWA
- [ ] Install prompt appears on mobile
- [ ] App works offline
- [ ] Offline page displays when disconnected

## PHASE 3: VISUAL & UX TESTING

### Responsive Design
- [ ] Desktop layout (1920px+)
- [ ] Tablet layout (768px-1919px)
- [ ] Mobile layout (320px-767px)
- [ ] All pages functional at each breakpoint

### Accessibility
- [ ] Keyboard navigation works throughout
- [ ] Focus states visible
- [ ] ARIA labels on interactive elements
- [ ] Colour contrast meets WCAG AA
- [ ] Screen reader compatible

### Visual Consistency
- [ ] Consistent spacing across pages
- [ ] Consistent button styles
- [ ] Consistent form field styles
- [ ] Loading states match design
- [ ] Empty states designed properly

### Performance
- [ ] Initial page load < 3 seconds
- [ ] Route changes feel instant (< 300ms)
- [ ] No memory leaks on long sessions
- [ ] Large lists virtualized if > 100 items

## PHASE 4: BUG FIXING PRIORITY

### Critical (Fix Before Launch)
- [ ] Login/authentication failures
- [ ] Data loss (forms not saving)
- [ ] Payment calculation errors
- [ ] Security vulnerabilities (XSS, injection)

### High (Fix Before Beta)
- [ ] Route optimization crashes
- [ ] PDF generation failures
- [ ] Email sending failures
- [ ] API rate limiting issues

### Medium (Fix Before Launch)
- [ ] UI glitches on mobile
- [ ] Slow page loads
- [ ] Search not finding results

### Low (Note for Future)
- [ ] Edge case error messages
- [ ] Minor visual inconsistencies

## PHASE 5: PRE-LAUNCH CHECKLIST

### Security
- [ ] All forms have CSRF protection
- [ ] RLS policies enforced on all tables
- [ ] No sensitive data in URL params
- [ ] API keys not exposed in frontend
- [ ] Webhook signatures verified

### Data Integrity
- [ ] Database backups configured
- [ ] No orphan records (foreign key constraints)
- [ ] Audit log capturing all changes

### Documentation
- [ ] User guide drafted
- [ ] Admin guide drafted
- [ ] API documentation (if applicable)

### Deployment
- [ ] Production environment configured
- [ ] Environment variables set correctly
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active

### Monitoring
- [ ] Error tracking (Sentry) configured
- [ ] Uptime monitoring active
- [ ] Log aggregation working

## PHASE 6: BETA TESTING

### Beta User Onboarding
- Recruit 2-3 window cleaning businesses
- Provide test credentials
- Schedule onboarding call

### Beta Feedback Collection
- In-app feedback button
- Weekly check-in calls
- Issue tracking (GitHub Issues or similar)

### Beta Metrics to Track
- Daily active users
- Routes created/completed
- Invoices generated
- Payment success rate
- Error frequency

### Beta Launch Communication
- Announcement email to beta users
- In-app announcement
- Documentation available

## PHASE 7: LAUNCH PREPARATION

### Pre-Launch Tasks
- [ ] Final security audit
- [ ] Performance audit
- [ ] Backup verification
- [ ] DNS propagation complete
- [ ] SSL certificate verified

### Launch Day
- [ ] Monitor error rates closely
- [ ] Quick response to user issues
- [ ] Beta user support priority

### Post-Launch
- [ ] Weekly iteration based on feedback
- [ ] Marketing activation
- [ ] Support ticket process active

## IMPORTANT NOTES

- All tests should be automated where possible
- Manual testing for complex user flows
- Document any workarounds found
- Track all bugs in issue tracker with severity tags
- No feature is complete without testing

## TECH STACK FOR TESTING

- Jest or Vitest (unit tests)
- Playwright or Cypress (E2E)
- Supabase (test environment)
- Sentry (error tracking)

Do not launch without passing the Critical and High priority tests.
