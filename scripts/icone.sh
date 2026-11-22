#!/usr/bin/env bash
# Rigenera fonts/material-symbols-rounded.woff2 con solo le icone elencate qui.
# Aggiungi il nome dell'icona (https://fonts.google.com/icons) alla lista e rilancia lo script.
set -euo pipefail
ICONS="add arrow_back arrow_drop_down arrow_forward cancel check check_box check_box_outline_blank
check_circle chevron_right cloud_off create_new_folder delete edit folder help history play_arrow quiz
radio_button_checked radio_button_unchecked refresh replay save school search settings smartphone style
sync touch_app upload_file visibility download close auto_awesome content_paste"
LIST=$(echo $ICONS | tr ' ' '\n' | sort -u | paste -sd,)
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
URL=$(curl -sf -A "$UA" "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&icon_names=$LIST&display=block" | grep -o 'https://fonts.gstatic.com[^)]*' | head -1)
curl -sf -o "$(dirname "$0")/../fonts/material-symbols-rounded.woff2" "$URL"
echo "Aggiornato fonts/material-symbols-rounded.woff2"
