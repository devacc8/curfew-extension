# Chrome Web Store: как выложить

Версия для первой публикации: **1.0.0**. Пакет собирается одной командой, тексты и
ответы для дашборда лежат ниже и готовы к копированию.

## 1. Что уже готово в репозитории

| Что | Где | Команда |
|---|---|---|
| ZIP для загрузки | `dist/curfew-extension-1.0.0.zip` | `npm run package` |
| Политика конфиденциальности | https://devacc8.github.io/curfew-extension/PRIVACY.html | Pages: ветка `main`, папка `/` |
| Иконка 128x128 | `icons/icon128.png` | `npm run gen:icons` |
| Скриншоты 1280x800 | `docs/screenshots/popup.png`, `options.png`, `wall.png`, `challenge.png`, `puzzle.png` | `npm run capture` |
| Промо-тайлы | `docs/promo/small-440x280.png`, `docs/promo/marquee-1400x560.png` | `npm run promo` |

Скриншотов ровно пять, это лимит стора. Шестой файл `docs/screenshots/strip.png`
(6520x800) сделан для README и в стор не загружается: там нужен размер 1280x800 или
640x400.

Проверка пакета перед загрузкой:

```bash
npm test          # линт, типы, 200 unit, инварианты
npm run smoke     # 14 E2E в headless Chrome
npm run package   # собирает dist/curfew-extension-1.0.0.zip и печатает sha256
```

`npm run package` сам отказывается собирать, если в манифесте нет обязательных полей,
если версия не похожа на версию, если иконки или локали не попали в архив, если в
исходниках появились сетевые вызовы, если архив больше 4 МБ или в нём больше 200 файлов.

## 2. Аккаунт разработчика (один раз, руками владельца аккаунта)

1. Открыть https://chrome.google.com/webstore/devconsole и войти Google-аккаунтом.
2. Заплатить разовый взнос $5. Больше платить нечего, публикация бесплатная.
3. Включить двухфакторную аутентификацию на этом аккаунте, без неё дашборд не работает.
4. Заполнить имя издателя (оно публичное) и контактный email, затем подтвердить email.
   Адрес для контакта указан в конце `PRIVACY.md`.

## 3. Порядок действий в дашборде

1. **New item**, загрузить `dist/curfew-extension-1.0.0.zip`.
2. **Store listing**: имя, краткое описание, подробное описание, категория, язык,
   иконка, скриншоты, промо-тайлы. Тексты в разделе 4.
3. **Privacy practices**: единственная цель, обоснование каждого разрешения, ответы про
   данные. Тексты в разделах 5 и 6.
4. **Distribution**: видимость `Public`, все регионы, бесплатно.
5. **Test instructions**: необязательное поле, но с ним обзор проходит быстрее. Текст в
   разделе 7.
6. **Submit for review**. Первый обзор обычно занимает от одного до трёх рабочих дней,
   иногда дольше. Статус виден на вкладке обзора, письмо придёт на контактный email.

## 4. Тексты листинга

### Name

```
Curfew
```

### Summary (лимит 132 символа)

Английский, он же лежит в `_locales/en/messages.json` как `extDesc`:

```
Daily time budgets for the sites you choose. Local-only, zero tracking.
```

Русский, для второго языка листинга (`_locales/ru/messages.json`):

```
Дневные лимиты времени для выбранных вами сайтов. Всё локально, ноль слежки.
```

### Category, language, links

- Category: `Productivity`. Если в списке есть `Well-being`, брать его, он точнее.
- Language: `English` как основной, затем добавить `Russian` вторым языком листинга.
- Homepage URL: https://github.com/devacc8/curfew-extension
- Support URL: https://github.com/devacc8/curfew-extension/issues
- Privacy policy URL: https://devacc8.github.io/curfew-extension/PRIVACY.html
- Mature content: нет. Видео: нет.

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

## 5. Privacy practices: обоснование разрешений

Дашборд просит текст под каждое разрешение. Ниже английские формулировки, они и нужны.

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

## 6. Privacy practices: ответы про данные

- **Does the extension collect or use user data?** Ни одна категория не отмечается: ни
  personally identifiable information, ни health, ни financial, ни authentication, ни
  personal communications, ни location, ни web history, ни user activity, ни website
  content. Обоснование, если поле спросит:

```
Curfew stores the user's own configuration (the sites they added, their budgets, settings and local counters) in chrome.storage.local on the device. That data is never transmitted to us or to anyone else, is not sold or shared, and is deleted when the extension is uninstalled. The extension makes no network requests at all.
```

- **Are you using remote code?** Нет. Вся логика лежит в архиве, ничего не
  подгружается и не выполняется извне. Запрет на сетевые примитивы проверяется тестом
  `tests/invariants.test.js`.
- **Certifications**: три подтверждения отмечаются как выполненные (данные не продаются,
  не используются для оценки кредитоспособности, не используются для целей, не связанных
  с единственной целью расширения).
- **Data usage / limited use**: соответствие политике подтверждается, собираемых данных нет.

## 7. Test instructions (для обзора)

```
No account and no credentials are needed. Install the extension, click the toolbar icon, type example.com into the field with a budget of 1 minute and press Add. Chrome asks for access to example.com, accept it. Open https://example.com in a tab and stay on it for about a minute: when the budget is spent the page is replaced by the "Under curfew" wall. The pass button on the wall ("Stay anyway for 15 minutes") opens a challenge first if Willpower Protection is enabled in the settings page. The same flow works for any site, x.com is what it is used for in practice. Nothing else is required and the extension works fully offline.
```

## 8. Чеклист отправки

- [ ] `npm test` и `npm run smoke` зелёные
- [ ] `npm run package`, версия в архиве 1.0.0
- [ ] Архив загружен в дашборд, манифест прочитан без ошибок
- [ ] Листинг заполнен, скриншоты 1280x800 загружены (пять штук), промо-тайлы загружены
- [ ] Privacy practices заполнены, ссылка на политику открывается без входа в аккаунт
- [ ] Distribution: Public, все регионы, бесплатно
- [ ] Submit for review

## 9. Обновления после публикации

1. Поднять версию в четырёх местах: `manifest.json`, `package.json`,
   `package-lock.json` (два места: корень и `packages[""]`), `docs/TECHNICAL_DESIGN.md`.
2. `npm test && npm run package`.
3. В дашборде **Package** загрузить новый zip, затем **Submit for review**. Правки без
   изменения разрешений обычно проходят быстрее.
4. Если что-то сломалось, в дашборде есть откат на предыдущую опубликованную версию.

Частые причины отказа и что у нас с ними: описание не совпадает с поведением (сверено с
кодом), разрешение без объяснения (объяснены все), несколько целей у одного расширения
(цель одна), непрозрачная работа с данными (данных нет, есть политика и тест на
отсутствие сети).
