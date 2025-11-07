# Push Instructions

After creating the repository on GitHub at https://github.com/shahrajs/JSONViewer, run:

```bash
cd /Users/rajshah/Desktop/JSONViewer
git push -u origin main
```

If you need to authenticate, GitHub may prompt you for credentials.
For HTTPS, you may need a Personal Access Token instead of a password.

## Alternative: Create repo using GitHub CLI

If you install GitHub CLI (`brew install gh`), you can create and push in one command:

```bash
gh repo create JSONViewer --public --source=. --remote=origin --push
```
