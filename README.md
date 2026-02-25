# Better Kick Modding
![ChatGPT Image 25  2  2026 23_53_48](https://github.com/user-attachments/assets/3e6cbf78-d135-4f95-aa18-3ca47abd77d2)


Rozšíření pro prohlížeč (Chrome, Edge), které vylepšuje vzhled a čitelnost chatu na **[Kick.com](https://kick.com)**. Inspirováno chatem na Twitchi – větší mezery, vizuální oddělení zpráv, zvýraznění odkazů a další nastavitelné úpravy.

---

## Funkce

| Funkce | Popis |
|--------|--------|
| **Mezery mezi zprávami** | Nastavitelná vertikální mezera mezi zprávami pro lepší čitelnost |
| **Vizuální oddělení** | Jemný hover efekt na řádcích chatu pro snazší skenování |
| **Styling odpovědí** | Zvýraznění bloků „Replying to…“ (barva, odsazení) |
| **Velikost emotů** | Omezení výšky/šířky emotů (např. 28px) pro konzistentní vzhled |
| **Zvýraznění odkazů** | Tučné zvýraznění uživatelských jmen a barevné zvýraznění URL odkazů v textu |
| **Velikost písma** | Nastavitelná velikost písma v chatu (11–18 px) |
| **Pozastavení při hoveru** | Při najetí myší na chat lze pozastavit scrollování |
| **Moderátorský úchop** | Táhnutí zprávy doprava pro moderátorské akce |

Všechny funkce lze zapínat a vypínat v popup okně rozšíření; nastavení se ukládá a synchronizuje (Chrome sync).

---

## Požadavky

- **Prohlížeč:** Chrome nebo Edge (Manifest V3)
- **Stránky:** `https://*.kick.com/*` (live stream s chatem)

---

## Instalace

1. **Stáhnout repozitář**  
   `git clone https://github.com/<váš-účet>/kick-extension.git`  
   nebo stáhnout ZIP a rozbalit.

2. **Otevřít stránku rozšíření**  
   - Chrome: `chrome://extensions/`  
   - Edge: `edge://extensions/`

3. **Zapnout režim vývojáře** (přepínač v pravém horním rohu).

4. **Načíst rozbalené rozšíření**  
   Tlačítko **„Načíst rozbalené“** → vybrat složku s projektem (ta, kde leží `manifest.json`).

5. Otevřít stream na Kick.com – rozšíření se na stránkách Kick aktivuje automaticky.

---

## Použití

- Po otevření streamu na **kick.com** se vylepšení chatu aplikují sama.
- Klik na **ikonu rozšíření** v liště prohlížeče otevře nastavení (popup).
- Jednotlivé funkce lze zapínat a vypínat zaškrtávacími políčky; změny se projeví ihned (případně po obnovení stránky).

---

## Struktura projektu

```
├── manifest.json          # Konfigurace rozšíření (Manifest V3)
├── content/
│   ├── content.js         # Hlavní logika – injekce stylů, detekce chatu, mod. nástroje
│   └── page-bridge.js     # Bridge pro komunikaci s stránkou
├── styles/
│   └── chat-enhancements.css
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js           # UI nastavení a ukládání do chrome.storage
└── icons/                 # Ikony 16, 48, 128 px
```

---

## Přizpůsobení ikon

V adresáři `icons/` lze nahradit výchozí ikony vlastními:

- `icon16.png` (16×16 px)
- `icon48.png` (48×48 px)
- `icon128.png` (128×128 px)

Po změně je vhodné v `chrome://extensions` u daného rozšíření kliknout na **Obnovit**.

---

## Kompatibilita a omezení

- Kick může měnit DOM a třídy stránek; při úpravách jejich frontendu může dojít k nutnosti aktualizace selektorů v rozšíření.
- Rozšíření neukládá hesla ani neposílá data mimo prohlížeč; používá pouze `chrome.storage` pro uložení preferencí.

---

## Přispívání

Úpravy a pull requesty jsou vítány. U větších změn je vhodné nejdřív otevřít issue a popsat záměr.

---

## Licence

Projekt je dostupný v tomto repozitáři; konkrétní licenci lze doplnit do souboru `LICENSE` nebo sekce v README.
