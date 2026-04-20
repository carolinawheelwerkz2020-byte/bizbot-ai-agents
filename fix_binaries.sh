#!/bin/bash
echo "Fixing binary signatures for macOS Apple Silicon..."
find node_modules -name "*.node" -exec xattr -rd com.apple.quarantine {} \;
find node_modules -name "*.node" -exec codesign --remove-signature {} \;
find node_modules -name "*.node" -exec codesign --sign - {} \;
echo "Done! Try running: npm run dev"
