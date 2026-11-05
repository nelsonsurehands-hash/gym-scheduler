# The Extra Coach Facilities

One gym and facility schedule for the whole school. Staff request times, the
administrator approves, and everyone sees the same calendar.

- **Live:** https://gym.theextracoach.com
- **Demo (no account, saved in your browser):** https://gym.theextracoach.com/?demo

## Roles
- **Administrator**: approves and declines, books directly, edits anything, adds people, changes settings.
- **Editor**: requests time. Requests wait for approval unless the admin turns on "Books without approval"
  for that person, or turns approval off for the school.
- **Viewer**: sees the schedule.

Staff are added by email on the People page and join the first time they sign in with that email.
Approved bookings can't overlap in the same space (the database blocks it).
Settings → "Schedule link for everyone" makes a read-only link anyone can open without signing in.

## Setup
1. Run `supabase/facilities.sql` once in the Supabase SQL editor (same project as The Extra Coach).
2. In Supabase → Authentication → URL Configuration, add `https://gym.theextracoach.com` to the redirect URLs.
3. GitHub Pages: deploy from `main`, custom domain `gym.theextracoach.com` (the CNAME file).
4. Cloudflare DNS: `CNAME gym → nelsonsurehands-hash.github.io` (DNS only / grey cloud until the certificate is issued).

Plain HTML, CSS and JavaScript. No build step.
