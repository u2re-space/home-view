# home-view

Speed Dial / домашний экран. View id: **`home`**. Иконка `house`. Регистрирует `<ui-icon>`.

Ориентированный рабочий стол, открытие других view через `setSpeedDialViewOpener`, overlay mount для меню и окон. SoT сетки и плиток — `fest/fl-ui` Speed Dial; этот пакет — адаптер под `View` / `ShellContext`.

```text
fl-ui Speed Dial + lure + icon
 └── home-view
      └── environment-shell → CWSP-shell / New Tab
```

## Запуск

```bash
cd modules/views/home-view
npm run dev
npm run build            # dist/home-view.js
```

```ts
import { HomeView, initializeOrientedDesktop } from "home-view/src";
```

Exports: `"."` → `dist/home-view.js`, `"./src"` → `src/index.ts`.
