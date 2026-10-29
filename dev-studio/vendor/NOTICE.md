# Pinned framework distributions
The four .tgz files are deliberate, bundled dependencies, not local runtime data.
Source: https://github.com/CraftOS-dev/Agent-App
Revision: 5e9c7a1e28fd4742cbb49e49188d63031f35c145
Licence: MIT (licence texts are included in the distributions).
SHA-256: SHA256SUMS; npm also checks the package-lock integrity values.
Packages: @a2app/rules, @a2app/sdk, @a2app/adapter-core, agent-app-framework.
The CLI tarball was built with a private blueprint-dev-studio copied from the pinned blueprint-react-node.
Only its initial manifest module declarations and toolkit id changed before scaffold.
server.mjs and a2app-update.js are byte-identical to the pinned official blueprint.
The private blueprint is bundled so a clean package can import/re-vendor without any sibling source checkout.
