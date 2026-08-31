// Sample parameters. Copy the values you need, or pass them inline with `-p key=value`.
//   az deployment group create -g rg-karta-prod -f infra/main.bicep -p infra/main.bicepparam
using './main.bicep'

param location = 'swedencentral'
param appName = 'karta'
param repositoryUrl = 'https://github.com/OWNER/karta'
param branch = 'main'

// Everyone who should hear about the budget crossing 50 / 80 / 100 percent.
param contactEmails = [
  'you@example.com'
]

// SEK per month. A tripwire — real spend should be a rounding error (spec 2).
param monthlyBudgetAmount = 100

// Only needed once a custom domain exists; the SWA hostname and http://localhost:5173
// are always allowed.
param additionalAllowedOrigins = []
