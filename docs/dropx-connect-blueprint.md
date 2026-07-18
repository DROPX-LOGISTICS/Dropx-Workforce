# DropX Connect Blueprint

## Product Direction

DropX Connect is the mobile app for employees, field executives, vendors, contractors, and managers.

The first version should be a mobile-first PWA, then wrapped as an Android app with native Firebase notifications. iOS can use the PWA first to avoid App Store review complexity.

## Core Decision

All profile data is company-specific. Nothing is shared between companies except the mobile number used to verify login.

If the same mobile number exists in multiple companies, the user sees an account/company switcher after OTP verification.

## Login Flow

1. User opens DropX Connect.
2. App asks for mobile number.
3. OTP is sent to the mobile number.
4. User verifies OTP.
5. App finds all active company profiles linked to that mobile number.
6. If one profile exists, open that company.
7. If multiple profiles exist, show company/account selector.
8. User creates app PIN.
9. User can enable biometric login.
10. Future logins use biometric first, PIN as fallback.

OTP is used only for first login, new device login, logout recovery, and forgot PIN.

## Company-Specific Profile Data

Each company profile can have its own:

- Profile photo
- Full name
- Mobile number
- Email
- Address
- Aadhaar
- PAN
- Bank account details
- Emergency contact
- Employee, vendor, contractor, or field executive ID
- Role and permissions
- Reporting manager
- Location access
- Joining date
- Status
- Documents
- Attendance, payout, and compliance rules

## First Version Modules

1. Login
2. Company/account switcher
3. App PIN and biometric setup
4. Home screen based on role
5. My Profile
6. My Documents
7. Notifications
8. Support/help

## Role-Based Home

The app should show only modules allowed for the selected company profile.

Suggested module groups:

- Employee: profile, documents, notifications, support
- Field executive: profile, onboarding documents, assigned location, task placeholder, notifications
- Vendor/contractor: compliance documents, staff list placeholder, invoices placeholder, notifications
- Manager: team view placeholder, approvals placeholder, document status, notifications

## Data Model Plan

Recommended new/updated tables:

- `connect_whatsapp_otp_requests`
- `connect_sms_otp_requests`
- `connect_email_otp_requests`
- `mobile_devices`
- `mobile_sessions`
- `mobile_push_tokens`
- `mobile_login_audit`

Existing company profile tables can remain company-specific:

- `profiles`
- `field_executives`
- vendor/contractor tables when added

Profile photo and KYC files should be stored per company/profile path, not shared globally.

## API Plan

Initial API routes:

- `POST /api/connect/auth/send-otp`
- `POST /api/connect/auth/verify-otp`
- `GET /api/connect/accounts`
- `POST /api/connect/accounts/select`
- `POST /api/connect/security/create-pin`
- `POST /api/connect/security/verify-pin`
- `POST /api/connect/security/register-device`
- `POST /api/connect/notifications/register-token`
- `GET /api/connect/profile`
- `PATCH /api/connect/profile`
- `POST /api/connect/profile/photo`
- `GET /api/connect/documents`
- `POST /api/connect/documents`

## Security Rules

- OTP must expire quickly.
- OTP attempts must be rate-limited.
- App PIN must never be stored as plain text.
- Biometric is handled by the device only.
- Every API call must validate active company profile, role, and location access.
- Suspended users must be blocked even if PIN or biometric succeeds.
- Device sessions should be revocable from admin later.

## Notification Plan

PWA:

- Supports Web Push where available.
- iOS requires Add to Home Screen and notification permission.

Android wrapper:

- Use Firebase Cloud Messaging.
- Store device token per company profile.
- Send individual, role, location, manager, or company notifications.

## Build Phases

### Phase 1: Foundation

- Mobile route shell
- Login screen
- OTP APIs
- Account selector
- PIN setup screen

### Phase 2: Profile

- Mobile home
- Profile view
- Profile edit
- Profile photo upload

### Phase 3: Documents

- My Documents list
- Upload document
- View/download document using secured DropX URLs

### Phase 4: Notifications

- In-app notifications
- PWA push registration
- Android Firebase bridge plan

### Phase 5: Android App

- Android wrapper
- Native notification bridge
- Play Store internal testing
