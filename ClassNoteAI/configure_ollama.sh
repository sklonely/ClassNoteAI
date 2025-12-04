#!/bin/bash

# Define variables
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$PLIST_DIR/com.sklonely.ollama.env.plist"

# Ensure LaunchAgents directory exists
mkdir -p "$PLIST_DIR"

# Create the plist file
cat <<EOF > "$PLIST_FILE"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sklonely.ollama.env</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>OLLAMA_HOST</string>
    <string>0.0.0.0</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

echo "Created LaunchAgent at $PLIST_FILE"

# Unload if it was already loaded (ignore error if not)
launchctl unload "$PLIST_FILE" 2>/dev/null

# Load the plist
launchctl load "$PLIST_FILE"
echo "Loaded LaunchAgent"

# Set the variable for the current session immediately
launchctl setenv OLLAMA_HOST "0.0.0.0"
echo "Set OLLAMA_HOST=0.0.0.0 for current session"

# Restart Ollama if it's running
echo "Restarting Ollama..."
pkill Ollama
# Wait a moment
sleep 2
# Open Ollama app
open -a Ollama

echo "Done! Ollama should now be listening on 0.0.0.0"
