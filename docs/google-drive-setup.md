# Setting up Google Drive

A one-time setup per installation of the app (the site and its GitHub repo),
about 20 minutes, in a browser on the Mac. It lets the devices add and stream
videos from the **shelf**: the Google Drive folder (normally "Kids Library")
that holds the prepared `.kidsvideo` files (see `tools/README.md`). Until it's
done, "Add from Google Drive" stays hidden and everything else works.

The devices sign in with a **device account**: a separate, regular (adult, not
Family Link) Google account with Viewer access to the shelf (the library
folder) and nothing else. The Google project lives on that account too.

1. **Create the device account** in a separate browser profile (accounts.google.com
   → Create account → For my personal use, adult birth date) and turn on its
   2-Step Verification. Stay signed in only as this account for the next
   steps: Google's console uses whichever account is active.
2. **Share the shelf** (the library folder) from the account that owns it: Share → add the
   device account as Viewer. No folder settings need changing.
3. **Check access** as the device account: drive.google.com → Shared with me
   shows the folder and offers Download on its files. Optionally: right-click the
   folder → Organize → Add shortcut to My Drive.
4. **Google Cloud project:** console.cloud.google.com → New project (no
   organization, no billing). APIs & Services → Library → enable **Google Drive
   API** and **Google Picker API**.
5. **Consent screen:** APIs & Services → OAuth consent screen → Get started.
   App name and support email (the device account); Audience: External. Under
   Branding: home page = the app's address, authorized domain = its domain.
   Data access → Add or remove scopes: add `https://www.googleapis.com/auth/drive.readonly`
   (a restricted scope; if it isn't in the list, paste it under "Manually add
   scopes"), then Update and Save. Audience → Test users: add the device
   account, and leave the app in Testing: test users need no Google review.
6. **Credentials** (APIs & Services → Credentials → Create credentials):
   - **OAuth client ID:** Web application. Authorized JavaScript origins: the
     site's origin only, for example `https://www.example.com` (no path, no
     trailing slash). No redirect URIs. The app doesn't use the client secret.
   - **API key:** then Edit it. Application restrictions: Websites →
     `https://www.example.com/*` (your site). API restrictions: only Google
     Picker API.
7. **Put two values in GitHub** (repo → Settings → Secrets and variables →
   Actions), then redeploy the latest release (Actions → Deploy → Run workflow
   with its tag) so the site serves them:

   | Name | Where | Where to find it | Looks like |
   |---|---|---|---|
   | `GOOGLE_CLIENT_ID` | Variables | Credentials → OAuth 2.0 Client IDs → your client | `123456789012-abc123….apps.googleusercontent.com` |
   | `GOOGLE_API_KEY` | Secrets | Credentials → API keys → your key → Show key | `AIza` + 35 letters, digits, `-` and `_` |

   The client ID is public by design (its leading digits, the project number,
   are what the Picker needs, so there's nothing else to copy). The API key is
   served to the browser too, but keep its only copies in GitHub and the Cloud
   console: don't paste it into notes, docs or the repo.
8. **On the iPad and iPhone:** open the app online, close it in the app
   switcher and open it again; "Add from Google Drive" shows next to "Add
   video". Add from Google Drive → Face ID → Continue → sign in as the device account. The
   first time, Google says it "hasn't verified this app" (it stays in Testing):
   Continue, then allow "See and download all your Google Drive files". Then
   Shared with me (or the shortcut) → pick `.kidsvideo` files or a folder. If
   the sign-in window doesn't open after Continue, check Settings → Safari → Block Pop-ups, or
   try from the site in a Safari tab.

**Later.** The device account's myaccount.google.com → Security → Your
connections to third-party apps lists the app with read-only access to Google
Drive; access can be removed there.

**Replacing the API key** (copied somewhere it shouldn't be, or its quota being
used up): Credentials → your key → Rotate key (or create a new key with the
same restrictions, then delete the old one) → update the `GOOGLE_API_KEY`
secret → redeploy the latest release.

