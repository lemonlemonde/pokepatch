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

### 1. Apply Database Migration

The database migration must be applied to your Supabase database:

**Option A: Using Supabase CLI**
```bash
cd pokepatch-website
supabase db push
```

**Option B: Using Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `supabase/migrations/20260716000000_customer_accounts.sql`
4. Paste and run in the SQL Editor

### 2. Configure Email Settings (Optional)

If you want to require email verification:

1. Go to Supabase Dashboard → Authentication → Email Templates
2. Customize the confirmation email template
3. Go to Authentication → Settings
4. Enable "Confirm email" under Email auth

If you want immediate login after signup (no email verification):
1. Go to Authentication → Settings
2. Disable "Confirm email" under Email auth

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
- `src/app/my-orders/page.js` - Customer order portal
- `src/components/OrderCard.js` - Order display component
- `supabase/migrations/20260716000000_customer_accounts.sql` - Database schema

### Modified Files
- `src/app/layout.js` - Added AuthProvider wrapper
- `src/app/thank-you/page.js` - Added optional account creation
- `src/components/Navbar.js` - Added conditional login/logout links

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
- [x] Database migration created and validated
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
