server 'mendicant.com',
       user: 'jason',
       roles: %w[app web]

# Requires Windows OpenSSH agent running in PowerShell with key loaded:
#   ssh-add ~/.ssh/id_rsa
set :ssh_options, {
  forward_agent: true,
  auth_methods:  %w[publickey]
}
