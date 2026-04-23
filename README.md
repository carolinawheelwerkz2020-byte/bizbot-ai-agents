<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/ff3bf5b0-7aab-4cf8-97e8-e0f8c60df3b4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Agent Freedom Controls

The local BizBot runtime has configurable autonomy controls in `.env`/`.env.local`:

- `RELAY_ALLOWED_COMMANDS` controls what executables agents can run.
- `RELAY_ALLOW_SHELL_OPERATORS=true` allows chained commands like `cmd1 && cmd2`.
- `BIZBOT_AUTO_APPROVE_ACTIONS` can auto-approve selected actions for trusted roles.

Example:

```env
RELAY_ALLOWED_COMMANDS=*
RELAY_ALLOW_SHELL_OPERATORS=true
BIZBOT_AUTO_APPROVE_ACTIONS=register_tool,save_healing_recipe,run_healing_recipe
```
