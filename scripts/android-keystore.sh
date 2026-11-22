#!/usr/bin/env bash
# Crea la chiave di firma dell'APK e la salva nei secret del repository GitHub,
# dove la usa il workflow .github/workflows/android.yml.
#
# Va eseguito UNA sola volta. Conserva la chiave (~/.android-keys/): se la perdi,
# chi ha installato l'app dovrà disinstallarla per installare le versioni successive.
#
# Richiede: keytool (JDK), openssl, gh autenticato.
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
DIR="$HOME/.android-keys"
KS="$DIR/studio-quiz.jks"
ALIAS="studioquiz"

if [[ -e "$KS" ]]; then
  echo "Esiste già $KS: non la sovrascrivo. Per ricaricare i secret, cancellala o caricali a mano." >&2
  exit 1
fi

mkdir -p "$DIR" && chmod 700 "$DIR"
PW="$(openssl rand -base64 32 | tr -d '/+=' | head -c 28)"

keytool -genkeypair -keystore "$KS" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PW" -keypass "$PW" -dname "CN=Studio Quiz" >/dev/null
printf 'keystore: %s\nalias: %s\npassword: %s\n' "$KS" "$ALIAS" "$PW" > "$DIR/studio-quiz.txt"
chmod 600 "$KS" "$DIR/studio-quiz.txt"

base64 -w0 "$KS" | gh secret set KEYSTORE_BASE64 -R "$REPO"
printf %s "$PW" | gh secret set KEYSTORE_PASSWORD -R "$REPO"
printf %s "$ALIAS" | gh secret set KEY_ALIAS -R "$REPO"

echo "Chiave creata in $KS (password in $DIR/studio-quiz.txt)."
echo "Secret KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS impostati su $REPO."
echo "Fai una copia di backup di $DIR."
