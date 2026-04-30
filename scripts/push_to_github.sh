#!/bin/bash

# Ensure the script stops on first error
set -e

# Load GITHUB_TOKEN from .env.local
if [ -f .env.local ]; then
  # Read the file line by line and export variables
  export $(grep -v '^#' .env.local | xargs)
else
  echo "Error: .env.local file not found!"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN is not set in .env.local"
  exit 1
fi

# Initialize git if not already initialized
if [ ! -d .git ]; then
  git init
  git branch -M main
fi

# Add all files
git add .

# Commit
git commit -m "feat: complete Category Intelligence Agent implementation" || echo "No changes to commit"

# Set remote URL with token for authentication
REPO_URL="https://oauth2:${GITHUB_TOKEN}@github.com/ramamurthy-540835/category-intelligence.git"

# Check if remote origin exists, if so update it, else add it
if git remote | grep -q '^origin$'; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

# Push to main branch
echo "Pushing to GitHub..."
git push -u origin main

echo "Successfully pushed to https://github.com/ramamurthy-540835/category-intelligence"
