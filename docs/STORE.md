# Chrome Web Store: how to publish

Live listing: https://chromewebstore.google.com/detail/curfew/obnikdokealeimpbhfbjhpdmfcgbgcje

First published version: **1.0.0**. The package builds with one command, and the listing
copy plus every dashboard answer sits below, ready to paste.

Everything written to a file in this repository is English, this document included. The blocks marked **RU**, **ZH** and **ES** are the store copy for those listing
languages, so they stay in their own language on purpose.

## 1. What the repository already has

| What | Where | Command |
|---|---|---|
| ZIP for upload | `dist/curfew-extension-1.1.0.zip` | `npm run package` |
| Privacy policy | https://devacc8.github.io/curfew-extension/PRIVACY.html | Pages: branch `main`, folder `/` |
| Icon 128x128 | `icons/icon128.png` | `npm run gen:icons` |
| Screenshots 1280x800 | `docs/screenshots/popup.png`, `options.png`, `wall.png`, `challenge.png`, `puzzle.png` | `npm run capture` |
| Promo tiles | `docs/promo/small-440x280.png`, `docs/promo/marquee-1400x560.png` | `npm run promo` |

There are exactly five screenshots, which is the store limit. The sixth file,
`docs/screenshots/strip.png` (6520x800), is made for the README and is never uploaded: the
store accepts 1280x800 or 640x400.

Every image the store takes must be a JPEG or a 24-bit PNG with no alpha channel. Chrome
writes the alpha channel only when a shot actually has transparency, so the rule is easy to
break without noticing. `npm run capture` and `npm run promo` therefore measure each file
after writing it (`scripts/png-check.mjs`) and fail loudly on a wrong size or an alpha
channel instead of producing an upload that the dashboard rejects.

Check the package before uploading:

```bash
npm test          # lint, types, 200 unit tests, invariants
npm run smoke     # 14 E2E checks in headless Chrome
npm run package   # builds dist/curfew-extension-1.1.0.zip and prints its sha256
```

`npm run package` refuses to build if the manifest is missing required fields, if the
version does not look like a version, if icons or locales did not make it into the archive,
if network calls appeared anywhere in the sources, or if the archive is over 4 MB or holds
more than 200 files.

## 2. Developer account (one time, done by hand by the account owner)

1. Open https://chrome.google.com/webstore/devconsole and sign in with a Google account.
2. Pay the one-time $5 registration fee. Nothing else costs money, publishing is free.
3. Turn on two-factor authentication for that account, the dashboard does not work without it.
4. Fill in the publisher name (it is public) and a contact email, then verify the email.
   The contact address is at the end of `PRIVACY.md`.

## 3. Steps in the dashboard

1. **New item**, then upload `dist/curfew-extension-1.1.0.zip`.
2. **Store listing**: name, short description, detailed description, category, language,
   icon, screenshots, promo tiles. The copy is in section 4.
3. **Privacy practices**: single purpose, a justification per permission, and the data
   answers. The copy is in sections 5 and 6.
4. **Distribution**: visibility `Public`, all regions, free.
5. **Test instructions**: optional, but it speeds up the review. The text is in section 7.
6. **Submit for review**. The first review usually takes one to three working days, sometimes
   longer. The review tab shows the status and the contact email gets a letter.

## 4. Listing copy

### Name

```
Curfew
```

### Summary (132 character limit)

English, the same string lives in `_locales/en/messages.json` as `extDesc`:

```
Daily time budgets for the sites you choose. Local-only, zero tracking.
```

Russian, for the second listing language (from `_locales/ru/messages.json`). This block is
meant to stay Russian:

**RU**

```
Дневные лимиты времени для выбранных вами сайтов. Всё локально, ноль слежки.
```

Chinese (Simplified), from `_locales/zh_CN/messages.json`:

**ZH**

```
为自选网站设置每日时间预算。完全本地，零追踪。
```

Spanish, from `_locales/es/messages.json`:

**ES**

```
Presupuestos diarios de tiempo para los sitios que elijas. Todo local, sin rastreo.
```

### Category, language, links

- Category: `Productivity`. If `Well-being` is offered, take it, it describes the product
  more closely.
- Language: `English` as the default, then add `Russian`, `Chinese (Simplified)` and
  `Spanish` as listing languages.
- Homepage URL: https://github.com/devacc8/curfew-extension
- Support URL: https://github.com/devacc8/curfew-extension/issues
- Privacy policy URL: https://devacc8.github.io/curfew-extension/PRIVACY.html
- Mature content: no. Promo video: none.

### Description (EN)

```
Curfew puts a daily time budget on the sites you choose, then closes them when the budget is spent.

You pick a site and a number of minutes per day. Curfew counts only the time you are actually there, with the tab open and the keyboard active. When the minutes run out the site is blocked at the network level until local midnight. Not a nag screen over the page: the request never completes.

WHY IT IS DIFFERENT
Most limiters give up the moment you click "5 more minutes". Curfew charges for that. Every pass is 15 minutes, passes are limited per day, and with Willpower Protection on, taking one means solving an equation or the 15-puzzle first. Adding a site and blocking one stay free, so the friction sits only on the permissive direction.

WHAT IT DOES
- A daily budget per site, from one minute up.
- Counts active time only: idle time and background tabs do not burn your budget.
- Recovers a little credit after time away, capped, so a short visit is not punished.
- Optional session limit and cooldown: a maximum continuous visit, then a forced break.
- Midnight reset on your local clock, with the day's credit split across the boundary.
- A wall page that shows where today's time went, with the pass button on it.
- Willpower Protection: an equation or the 15-puzzle before any permissive change, including importing a file.
- Appearance follows the system, or pick dark or light.
- Export and import a JSON file you own. Nothing else leaves the browser.

WHAT IT DOES NOT DO
- No account, no sign in, no sync.
- No analytics, no telemetry, no crash reporting.
- No network requests at all: there is no server to talk to, and a test in the repository enforces that.
- No reading of your browsing history. Curfew knows a site only because you added it.
- No install warnings: site access is asked for one site at a time and can be revoked.

Works offline. Manifest V3. Open source under the MIT license.
```

### Description (RU)

This block is the copy for the Russian-language listing, so it stays Russian.

**RU**

```
Curfew ставит дневной лимит на сайты, которые вы сами выбрали, и закрывает их, когда лимит исчерпан.

Вы выбираете сайт и число минут в день. Curfew считает только то время, когда вы действительно там: вкладка открыта, клавиатура активна. Когда минуты заканчиваются, сайт блокируется на сетевом уровне до местной полуночи. Это не надоедливая плашка поверх страницы: запрос просто не доходит.

ЧЕМ ОТЛИЧАЕТСЯ
Большинство лимитеров сдаются в тот момент, когда вы нажимаете «ещё 5 минут». Curfew берёт за это плату. Каждый пропуск это 15 минут, пропуски ограничены на день, а с включённой защитой воли пропуск нужно сначала заслужить: решить уравнение или собрать пятнашки. Добавление сайта и блокировка остаются бесплатными, трение стоит только на послаблении.

ЧТО УМЕЕТ
- Дневной лимит на каждый сайт, от одной минуты.
- Считает только активное время: простой и фоновые вкладки лимит не съедают.
- Немного возвращает времени после паузы, с потолком, чтобы короткий заход не наказывался.
- Необязательные лимит сессии и перерыв: максимум непрерывного визита, потом обязательная пауза.
- Сброс в местную полночь, с правильным разделением зачёта по границе дня.
- Стена, которая показывает, куда ушло время за сегодня, и кнопку пропуска на ней.
- Защита воли: уравнение или пятнашки перед любым послаблением, включая импорт файла.
- Оформление как в системе, либо тёмная или светлая тема вручную.
- Экспорт и импорт JSON-файла, который принадлежит вам. Больше из браузера ничего не уходит.

ЧЕГО НЕ ДЕЛАЕТ
- Ни аккаунта, ни входа, ни синхронизации.
- Ни аналитики, ни телеметрии, ни отчётов о падениях.
- Ни одного сетевого запроса: сервера, с которым можно поговорить, не существует, и это проверяется тестом в репозитории.
- Не читает историю браузера. Curfew узнаёт о сайте только потому, что вы его добавили.
- Никаких предупреждений при установке: доступ спрашивается по одному сайту и его можно отозвать.

Работает офлайн. Manifest V3. Открытый код под лицензией MIT.
```

### Description (ZH)

Copy for the Simplified Chinese listing, so it stays Chinese.

**ZH**

```
Curfew 为你选择的网站设置每日时间预算，预算用完后把网站关掉。

你选一个网站和每天的分钟数。Curfew 只统计你确实在里面的时间：标签页打开、键盘有操作。分钟用完后，网站会在网络层被拦住，直到本地时间的午夜。这不是浮在页面上的提醒框，请求根本不会完成。

有何不同
大多数限制工具在你点下「再来 5 分钟」的那一刻就失效了。Curfew 会为此收费。每次通行是 15 分钟，每天的次数有限，而开启意志力保护后，通行前必须先解一道算式或数字华容道。添加网站和屏蔽始终免费，阻力只加在放松的那一侧。

它能做什么
- 每个网站一个每日预算，最低一分钟。
- 只统计活跃时间：空闲和后台标签页不消耗预算。
- 离开一段时间后返还少量额度，有上限，短时间访问不会被惩罚。
- 可选的单次上限和休息：一次连续访问的最长时间，之后强制休息。
- 按本地时间午夜重置，当天的额度会正确穿过日期边界。
- 拦截页面会显示今天的时间花在哪里，通行按钮就在上面。
- 意志力保护：任何放松限制的操作之前都要先解算式或数字华容道，导入文件也一样。
- 外观跟随系统，也可以手动选深色或浅色。
- 导出和导入属于你自己的 JSON 文件。除此之外没有任何数据离开浏览器。

它不做什么
- 没有账号，没有登录，没有同步。
- 没有分析，没有遥测，没有崩溃上报。
- 完全没有网络请求：根本没有服务器可以通信，这一点由仓库里的测试保证。
- 不读取你的浏览历史。Curfew 只认识你亲自添加的网站。
- 安装时没有任何警告：访问权限逐个网站申请，并且可以随时撤销。

离线可用。Manifest V3。MIT 许可下的开源软件。
```

### Description (ES)

Copy for the Spanish listing, so it stays Spanish.

**ES**

```
Curfew pone un presupuesto diario de tiempo en los sitios que tú elijas y los cierra cuando se agota.

Eliges un sitio y un número de minutos al día. Curfew cuenta solo el tiempo que de verdad estás allí: con la pestaña abierta y el teclado activo. Cuando se acaban los minutos, el sitio se bloquea a nivel de red hasta la medianoche local. No es un aviso encima de la página: la petición nunca llega.

POR QUÉ ES DISTINTO
Casi todos los limitadores se rinden en el momento en que pulsas "5 minutos más". Curfew te lo cobra. Cada pase son 15 minutos, los pases tienen un límite diario y, con la Protección de la fuerza de voluntad activada, conseguir uno exige resolver antes una ecuación o el rompecabezas de 15. Añadir un sitio y bloquear uno siguen siendo gratis, así que la fricción está solo en la dirección permisiva.

QUÉ HACE
- Un presupuesto diario por sitio, desde un minuto.
- Cuenta solo el tiempo activo: el rato inactivo y las pestañas en segundo plano no gastan tu presupuesto.
- Devuelve un poco de crédito tras un tiempo fuera, con tope, para no castigar una visita corta.
- Límite de sesión y descanso opcionales: un máximo de visita continua y después una pausa obligatoria.
- Reinicio a medianoche en tu reloj local, repartiendo el crédito del día a través del cambio de fecha.
- Una página de bloqueo que muestra en qué se fue el tiempo de hoy, con el botón de pase encima.
- Protección de la fuerza de voluntad: una ecuación o el rompecabezas de 15 antes de cualquier cambio permisivo, incluida la importación de un archivo.
- La apariencia sigue al sistema, o eliges oscuro o claro a mano.
- Exporta e importa un archivo JSON que es tuyo. Nada más sale del navegador.

QUÉ NO HACE
- Sin cuenta, sin inicio de sesión, sin sincronización.
- Sin analíticas, sin telemetría, sin informes de fallos.
- Ninguna petición de red: no hay servidor con el que hablar, y un test del repositorio lo garantiza.
- No lee tu historial de navegación. Curfew solo conoce un sitio porque tú lo añadiste.
- Sin avisos al instalar: el acceso se pide sitio a sitio y se puede revocar.

Funciona sin conexión. Manifest V3. Código abierto con licencia MIT.
```

## 5. Privacy practices: permission justifications

The dashboard asks for text under every permission. The wording below is what goes in.

**Single purpose**

```
Curfew has one purpose: to let the user set a daily time budget for specific websites and to enforce it by blocking those sites at the network level once the budget is spent.
```

**storage**

```
Stores the user's own configuration on the user's own machine: the sites they added, their daily budgets, settings and per-site counters, in chrome.storage.local. It is what makes the extension work offline and across restarts. Nothing is transmitted anywhere, and uninstalling the extension deletes it.
```

**alarms**

```
Schedules the transitions the user asked for: re-checking an already open tab so a spent budget closes the page without waiting for a navigation, the reset at local midnight, the end of a 15-minute pass, the end of a cooldown and the end of a session limit. Without alarms those transitions would only happen while a page happened to be open.
```

**idle**

```
Counts time only while the user is actually at the keyboard. The idle API is how Curfew knows to stop counting and when to resume, so a tab left open and unattended does not consume the budget.
```

**declarativeNetRequestWithHostAccess**

```
This is the mechanism that closes a site once its budget is spent. Rules are created only for sites the user added and granted access to, one block rule per site. Curfew does not read, log or store any request data; it only declares that requests to those specific hosts are blocked.
```

**contextMenus**

```
Adds a single right-click item, "Add this site to Curfew", so a site can be added from the page the user is on. It is a convenience shortcut to the same field that exists in the settings page.
```

**activeTab**

```
Reads the address of the current tab, and only when the user clicks the "Add this site to Curfew" context menu item, in order to prefill the site field. Curfew never reads browsing history and never touches other tabs.
```

**Optional host permissions (`*://*/*`)**

```
Host access is optional and requested one origin at a time, only for the site the user is adding at that moment. The extension has no access to any site until the user grants it, and any grant can be revoked in chrome://extensions at any time. This is why installing Curfew shows no permission warnings.
```

## 6. Privacy practices: data answers

- **Does the extension collect or use user data?** No category is checked: not personally
  identifiable information, not health, not financial, not authentication, not personal
  communications, not location, not web history, not user activity, not website content.
  If a field asks for a justification, this is it:

```
Curfew stores the user's own configuration (the sites they added, their budgets, settings and local counters) in chrome.storage.local on the device. That data is never transmitted to us or to anyone else, is not sold or shared, and is deleted when the extension is uninstalled. The extension makes no network requests at all.
```

- **Are you using remote code?** No. All the logic ships inside the archive, nothing is
  fetched or executed from outside. The ban on network primitives is enforced by
  `tests/invariants.test.js`.
- **Certifications**: all three are confirmed (data is not sold, not used for
  creditworthiness, not used for purposes unrelated to the extension's single purpose).
- **Data usage / limited use**: compliance is confirmed, and there is no collected data to
  begin with.

## 7. Test instructions (for the reviewer)

```
No account and no credentials are needed. Install the extension, click the toolbar icon, type example.com into the field with a budget of 1 minute and press Add. Chrome asks for access to example.com, accept it. Open https://example.com in a tab and stay on it for about a minute: when the budget is spent the page is replaced by the "Under curfew" wall. The pass button on the wall ("Stay anyway for 15 minutes") opens a challenge first if Willpower Protection is enabled in the settings page. The same flow works for any site, x.com is what it is used for in practice. Nothing else is required and the extension works fully offline.
```

## 8. Submission checklist

- [ ] `npm test` and `npm run smoke` are green
- [ ] `npm run package`, and the version inside the archive is 1.1.0
- [ ] The archive is uploaded and the dashboard reads the manifest without errors
- [ ] The listing is filled in, five 1280x800 screenshots uploaded, promo tiles uploaded
- [ ] Privacy practices are filled in, and the policy link opens without signing in
- [ ] Distribution: Public, all regions, free
- [ ] Submit for review

## 9. Updates after publishing

1. Bump the version in four places: `manifest.json`, `package.json`,
   `package-lock.json` (two spots: the root and `packages[""]`), and
   `docs/TECHNICAL_DESIGN.md`.
2. `npm test && npm run package`.
3. In the dashboard upload the new zip on the **Package** tab, then **Submit for review**.
   Changes that do not touch permissions usually clear the review faster.
4. If a release turns out broken, the dashboard can roll back to the previous published
   version.

Common rejection reasons and where this project stands: the description does not match the
behaviour (checked against the code), a permission without an explanation (all of them are
explained), more than one purpose (there is one), unclear data handling (there is no data,
and there is a policy plus a test that the extension never opens a network connection).
