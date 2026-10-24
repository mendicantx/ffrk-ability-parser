server 'mendicant.com',
       user: 'jason',
       roles: %w[app web]

# Logging in needs a key the server accepts. Locally that's the Windows OpenSSH agent
# with your key loaded (ssh-add ~/.ssh/id_rsa); on GitHub Actions it's DEPLOY_SSH_KEY
# (.github/workflows/deploy.yml). The agent isn't forwarded: the server clones the
# repo over HTTPS and never needs your key.
set :ssh_options, {
  forward_agent: false,
  auth_methods:  %w[publickey]
}
