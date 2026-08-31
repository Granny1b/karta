# First deployment

Everything lives in one resource group in Sweden Central, so a single budget and a single
delete cover the whole system. You need the Azure CLI (`az version` ≥ 2.60, which bundles
Bicep) and permission to create resources in the subscription.

Run these from the repo root.

## 1. Sign in and pick the subscription

```bash
az login
az account set --subscription "<subscription name or id>"
az account show --query "{name:name, id:id}" -o table
```

## 2. Create the resource group

```bash
az group create --name rg-karta-prod --location swedencentral
```

## 3. Deploy the infrastructure

Copy `infra/main.bicepparam` and fill in your GitHub repository URL and the address that should
receive budget alerts, then:

```bash
az deployment group create \
  --resource-group rg-karta-prod \
  --name karta-infra \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

Or pass the two required values inline:

```bash
az deployment group create \
  --resource-group rg-karta-prod \
  --name karta-infra \
  --template-file infra/main.bicep \
  --parameters repositoryUrl=https://github.com/OWNER/karta contactEmails='["you@example.com"]'
```

This creates the storage account (Hot, LRS, no public blob access, 14-day blob soft delete),
the `boards` / `media` / `snapshots` containers, the blob CORS rule, the Free-tier Static Web
App, the SWA app settings that carry the storage connection string, and the 100 SEK/month
resource-group budget with alerts at 50, 80 and 100 percent.

Read the outputs back:

```bash
az deployment group show -g rg-karta-prod -n karta-infra --query properties.outputs -o json
```

`swaDefaultHostname` is the production URL, `swaName` is what the next step needs.

> The CORS rule names the SWA hostname directly (`swa.properties.defaultHostname`), and the
> template declares the Static Web App before the blob service, so the first deployment already
> writes the real origin. No second pass is needed for this.

## 4. Put the deployment token in GitHub

The workflow authenticates with the SWA deployment token — not with a service principal.

```bash
az staticwebapp secrets list \
  --name swa-karta \
  --resource-group rg-karta-prod \
  --query "properties.apiKey" -o tsv
```

Add it as a repository secret named `AZURE_STATIC_WEB_APPS_API_TOKEN`:

```bash
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo OWNER/karta
```

or in the GitHub UI under **Settings → Secrets and variables → Actions → New repository
secret**. Push to `main` and `.github/workflows/azure-static-web-apps.yml` builds and deploys.
If you ever reset the token (`az staticwebapp secrets reset-api-key`), update the secret too.

## 5. Invite yourself as a `member`

Signing in proves who you are; the custom role `member` is what opens the door. Nobody has it
until you hand it out.

1. Azure portal → the static web app **swa-karta** → **Settings → Role management**.
2. **Invite** → provider **Microsoft** (or **GitHub**) → the email or username → domain
   `<hostname from step 3>` → role `member` → expiry up to 30 days.
3. Open the generated invitation link while signed in as that account and accept it.

Repeat per collaborator. The free tier allows 25 invited users; this project needs three.

Check it worked: sign in at the SWA URL. Without the role you land on `no-access.html`; with it
you get the board. `GET /api/me` echoes the identity and roles the API sees.

## 6. Re-run the deployment when the allowed origins change

The browser talks to blob storage directly, so any origin that serves the app has to be in the
storage CORS rule. `https://<swa hostname>` and `http://localhost:5173` are always there. Add a
custom domain, or any other origin, through the parameter and deploy again:

```bash
az deployment group create \
  --resource-group rg-karta-prod \
  --name karta-infra \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters additionalAllowedOrigins='["https://karta.example.com"]'
```

The deployment is idempotent, so re-running it is also the way to confirm the live CORS rule
still matches the real hostname:

```bash
az storage cors list --account-name <storageAccountName> --services b -o table
```

Symptom of getting this wrong: images fail to upload or render with a CORS error in the browser
console while `/api/*` keeps working.

## Key rotation

The storage account key sits in the SWA app setting `STORAGE_CONNECTION_STRING` rather than in
Key Vault — SWA managed functions cannot use managed identity for anything except pulling
secrets from Key Vault, and Key Vault adds a resource, a reference syntax and a failure mode
for a single-tenant hobby board. The trade is that rotation is manual. If the key ever leaks:

```bash
az storage account keys renew \
  --account-name <storageAccountName> \
  --resource-group rg-karta-prod \
  --key primary
```

Then re-run the deployment from step 3 so the SWA app setting picks up the new key, and confirm
the app can load a board again. Media SAS URLs minted with the old key stop working
immediately; the client mints fresh ones on the next read-token refresh.

## Tearing it down

```bash
az group delete --name rg-karta-prod --yes
```

That is the whole system. Blob soft delete does not survive the account being deleted, so
export anything worth keeping first.
