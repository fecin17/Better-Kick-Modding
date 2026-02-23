# Kick Chat Enhancer

Webová rozšíření pro vylepšení vzhledu a čitelnosti chatu na **Kick.com**, inspirované chatem na Twitchi.

## Rozdíly oproti výchozímu Kick chatu

| Výchozí Kick | S rozšířením |
|--------------|--------------|
| Malé mezery mezi zprávami | Větší vertikální rozestupy |
| Chybí vizuální oddělení | Hover efekt a oddělení zpráv |
| Odpovědi splývají | Barevné zvýraznění a odsazení |
| Příliš velké emoty | Limit velikosti emotů (28px) |
| Jména bez důrazu | Tučné zvýraznění uživatelských jmen |

## Instalace (Chrome / Edge)

1. Stáhni nebo naklonuj tento adresář
2. Otevři `chrome://extensions/`
3. Zapni **Režim vývojáře** (vpravo nahoře)
4. Klikni **Načíst rozbalené**
5. Vyber složku `kick extension`

### Vlastní ikonky

Ikony rozšíření (v liště a v nastavení) můžeš nahradit vlastními. Do složky `icons/` přidej soubory **icon16.png** (16×16 px), **icon48.png** (48×48 px) a **icon128.png** (128×128 px). Podrobnosti jsou ve složce `icons/` v souboru README.md. Po úpravě ikon v rozšíření klikni na **Obnovit**.

## Použití

1. Otevři stream na **kick.com**
2. Rozšíření se automaticky aktivuje
3. Klikni na ikonu rozšíření v liště pro zapnutí/vypnutí jednotlivých funkcí

## Nastavení (popup)

- **Větší mezery mezi zprávami** – zlepší čitelnost při rychlém proudu chatu
- **Vizuální oddělení zpráv** – jemný hover efekt pro lepší skenování
- **Lepší styling odpovědí** – zvýraznění „Replying to…“
- **Limit velikosti emotů** – sjednocení velikosti emotů
- **Zvýraznění uživatelských jmen** – tučné písmo pro jména

## Plánované funkce (moderátorské nástroje)

- Kontextové menu při kliknutí na zprávu/uživatele
- Rychlé akce: ban, timeout, smazání zprávy
- Zvýraznění zpráv od moderátorů/streamera
- Případně další vylepšení podle zpětné vazby

## Poznámky

- Po změně nastavení v popup obnov stránku na Kick.com.
- Kick může měnit DOM strukturu – pokud něco nebude fungovat, napiš a selektory upravíme.
