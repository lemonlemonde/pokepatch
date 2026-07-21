# Customer Login & Order Tracking System

## Overview

This implementation adds an optional customer login system that allows users to track their orders online. The key feature is that **users can submit orders without creating an account**, and they can optionally create an account later to track their orders.

## Features Implemented

### 1. **Optional Account Creation**
- Users can submit orders without creating an account (existing flow unchanged)
- After order submission, the thank-you page offers optional account creation
- Orders are automatically linked when users sign up using the same email

### 2. **Customer Portal** (`/my-orders`)
- Displays all orders linked to the customer's account
- Expandable order cards show:
  - Card names, sets, and descriptions
  - Customer-submitted photos
  - Admin-uploaded photos (marked with "Update" badge)
  - Contact information
  - Delivery method
  - Admin notes
- Visual indicator when admin has added new photos

### 3. **Authentication**
- Login page at `/login`
- Combined login/signup interface
- Email verification support (configurable in Supabase)
- Secure authentication via Supabase Auth
- Auto-login after signup (if email confirmation is disabled)

### 4. **Navigation**
- Navbar dynamically shows:
  - "Log in" link for anonymous users
  - "My Orders" link for authenticated users
- Sign out button on the My Orders page

## Setup Instructions

### 1. Database prerequisites

Customer accounts schema is already applied on the live Supabase project
(`orders.user_id`, `get_my_orders` / `get_my_order`, related RLS, etc.).

Future schema changes use **CLI-managed migrations** from `pokepatch-website/` (`supabase migration new` → `supabase db push`). Never hand-name migration files or apply remote DDL without syncing local — see root [README → Schema changes (CLI-managed)](../README.md#schema-changes-cli-managed).

```bash
supabase link --project-ref <ref>   # once per machine
supabase migration new <short_name>
# edit the new file under supabase/migrations/
supabase db push
supabase migration list             # Local and Remote must match
```

### 2. Configure Email Settings (Resend SMTP)

Supabase’s built-in mailer is rate-limited (~2 emails/hour) and only delivers to project team addresses. For production signup confirmation, send Auth emails through **Resend** via custom SMTP. The app still uses `supabase.auth.signUp` / `auth.resend`; Resend only delivers the message.

#### A. Resend + Porkbun DNS

1. Create a [Resend](https://resend.com) account and an API key.
2. In Resend → **Domains** → **Add Domain**, enter your root domain (e.g. `pokepatch.com`).
3. In Porkbun → your domain → **DNS**, add the records Resend shows (typically DKIM TXT, SPF TXT on the `send` subdomain, and MX for that subdomain). Optionally add DMARC at `_dmarc` if you do not already have one.
4. Watch for doubled hostnames in Porkbun (e.g. `resend._domainkey.yourdomain.com.yourdomain.com`). Use the host Resend lists without appending the domain twice.
5. Click **Verify** in Resend until the domain is verified.
6. Choose a From address on that domain, e.g. `noreply@yourdomain.com` or `auth@yourdomain.com`.

#### B. Supabase SMTP

1. Supabase Dashboard → **Authentication** → **Email** (Notifications) → **SMTP Settings**.
2. Enable custom SMTP and set:

| Setting | Value |
|---------|--------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | Resend API key |
| Sender email | your verified From address |
| Sender name | e.g. `Pokepatch` |

Alternatively: Resend → **Integrations** → Connect to Supabase (writes the same SMTP config).

3. Under Auth email settings, keep **Confirm email** enabled (the site’s `/verify-email` flow expects this).
4. Under **Authentication → Rate Limits**, raise the email rate limit above the default (~30/hour) so signup volume is not capped by Auth after SMTP is connected.
5. Under **Authentication → URL Configuration**:
   - Set **Site URL** to your production site (e.g. `https://yourdomain.com`).
   - Add redirect allowlist entries for confirmation links, e.g. `https://yourdomain.com/**` and `http://localhost:3000/**` for local dev.

Signup and resend already pass `emailRedirectTo` to `/my-orders` on the current origin.

If you want immediate login after signup (no email verification):
1. Go to Authentication → Settings
2. Disable "Confirm email" under Email auth

(You can skip Resend SMTP in that case, but production apps should keep confirmation on.)

### 3. Storage Bucket Permissions

Ensure the `card-photos` storage bucket has the correct public access policy:

```sql
-- Run this in Supabase SQL Editor if images aren't loading
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do update set public = true;
```

## User Flows

### Flow 1: New User Submits Order
1. User fills out quote form (no login required)
2. User submits order
3. User lands on thank-you page
4. **Optional:** User creates account using same email → orders are auto-linked
5. User is redirected to `/my-orders` to view their orders

### Flow 2: Existing User Submits Order
1. User fills out quote form (no login required)
2. User submits order
3. User lands on thank-you page showing "linked to your account"
4. User can click "View my orders" to see all orders

### Flow 3: User Creates Account Later
1. User previously submitted orders without an account
2. User visits `/login` and creates account
3. During signup, the system automatically claims any orders matching their email
4. User can now track their orders at `/my-orders`

### Flow 4: Admin Updates Order
1. Admin uploads photos or adds notes to an order (via existing admin panel)
2. Customer sees "Updates available" badge on order card
3. Customer expands order to view admin photos (marked with "Update" badge)

## Technical Architecture

### Database Schema
- `orders.user_id` - Links orders to authenticated users (nullable)
- `claim_my_orders()` - Finds and links orders by matching email
- `get_my_orders()` - Returns all orders for authenticated user
- `get_my_order(uuid)` - Returns full details for a specific order
- RLS policies ensure customers only see their own orders

### Authentication Flow
1. User signs up/logs in via Supabase Auth
2. `AuthContext` manages authentication state globally
3. On login/signup, `claim_my_orders()` is automatically called
4. Orders with matching contact emails are linked to user account

### Security
- Row Level Security (RLS) policies prevent unauthorized access
- Customers can only view orders where `user_id = auth.uid()`
- Order submission remains public (via `create_order` function)
- Admin functions remain restricted to service role

## Files Added/Modified

### New Files
- `src/contexts/AuthContext.js` - Authentication state management
- `src/app/login/page.js` - Login/signup page
- `src/app/verify-email/page.js` - Post-signup confirm-email + resend UI
- `src/app/my-orders/page.js` - Customer order portal
- `src/components/OrderCard.js` - Order display component

### Modified Files
- `src/app/layout.js` - Added AuthProvider wrapper
- `src/app/thank-you/page.js` - Added optional account creation
- `src/components/Navbar.js` - Added conditional login/logout links
- `src/lib/customerAuth.js` - Feature flag + `getAuthEmailRedirectTo` for confirmation links

## Admin Workflow Updates

When you want to update customers:

1. Go to `/admin/orders` as usual
2. Upload photos to orders (use `image_type: 'admin'`)
3. Add notes to `general_notes` field
4. Customers with accounts will see:
   - "Updates available" badge on order list
   - Admin photos marked with "Update" badge
   - Admin notes in order details

## Testing Checklist

- [x] Project builds successfully without errors
- [x] Database prerequisites confirmed on live
- [x] Auth context provider created
- [x] Login/signup page created with Suspense boundary
- [x] My Orders page created
- [x] Order tracking component created
- [x] Thank-you page updated with account creation
- [x] Navbar updated with conditional links
- [ ] *Live testing (requires Supabase credentials):*
  - [ ] Submit order without account
  - [ ] Create account with matching email
  - [ ] Verify order appears in My Orders
  - [ ] Admin uploads photo
  - [ ] Customer sees update badge
  - [ ] Sign out and sign in works

## Admin broadcast messages (Resend API)

Admins can email customers from **Admin → Messages**. Sends go through the
`admin-api` edge function (admin session required) using Resend’s HTTP API —
not Auth SMTP. Messages are also stored in `customer_messages` and shown on
`/messages`.

### Database

`customer_messages` (and related RLS / RPCs) is already on live. Future message
schema changes: `supabase migration new` → `supabase db push`, then deploy
`admin-api`.

### Edge function secrets

Set these on the project (same Resend account/domain as Auth SMTP is fine):

```bash
supabase secrets set RESEND_API_KEY="re_..." RESEND_FROM_EMAIL="PokePatch <noreply@pokepatch.cards>"
```

`RESEND_FROM_EMAIL` must use a verified Resend domain. Redeploy `admin-api`
after setting secrets and after pulling the Messages actions.

Confirm `ADMIN_ALLOWED_EMAILS` is still set — only allowlisted admins can mint
an admin session, and every send goes through that session gate.

## Future Enhancements

Consider adding these features in future iterations:

1. **Password Reset** - Allow users to reset forgotten passwords
2. **Order Status Tracking** - Add status field (Received, In Progress, Complete)
3. **Email Notifications** - Notify customers when admin updates their order
4. **Social Login** - Add Google, Discord, or Instagram login options
5. **Order Messaging** - Allow customers to send messages to admin
6. **Order History** - Archive completed orders separately
7. **Profile Management** - Let users update email, password, etc.

## Troubleshooting

### Issue: "Authentication is not configured"
**Solution:** Ensure environment variables are set:
```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

### Issue: Confirmation emails not arriving / "Email address not authorized"
**Solution:** Configure custom SMTP with Resend (see **Configure Email Settings** above). Until SMTP is set, Supabase only sends to project team emails and rate-limits heavily. Check the Resend dashboard **Emails** log after signup.

### Issue: Confirmation link lands on wrong host or errors
**Solution:** Set Site URL and Redirect URLs in Supabase Auth URL Configuration to match your site (and localhost for dev). Confirmation emails use `emailRedirectTo` → `/my-orders`.

### Issue: Orders not auto-linking
**Solution:** Ensure the email used for signup matches exactly with the email in order contacts (case-insensitive comparison is already implemented)

### Issue: Images not loading
**Solution:** Check that the `card-photos` bucket is set to public and the storage policies allow public reads

### Issue: Build errors
**Solution:** Run `npm install` to ensure all dependencies are installed, then `npm run build`

## Notes

- The order submission flow remains **unchanged** - users do NOT need accounts to submit orders
- This system is additive and does not modify existing order data
- All existing orders will work; they just won't be linked to accounts initially
- Email matching is case-insensitive for better user experience
- The system is designed to be non-intrusive and optional for customers
