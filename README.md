# PriceCore — MVP (versión local, sin backend)

Herramienta interna para comparar listas de precios de proveedores contra el catálogo propio, con matching por niveles, revisión humana obligatoria para lo dudoso, y exportación a Excel para actualizar el sistema de gestión manualmente. Corre 100% en el navegador — no hay servidor, no hay login, no hay nube.

Ver `/PriceCore_Fase1_Analisis.md` para el análisis original de CompraCore.

## Puesta en marcha

```bash
npm install
npm run dev
```

Abrí `http://localhost:5173`. Sin variables de entorno, sin cuenta.

## Qué hay en esta versión

### Flujo principal
- Tu **catálogo de productos** vive en una sección propia (`Catálogo`) — lo cargás una vez (importando un archivo o agregando productos a mano) y queda guardado en el navegador. Las comparaciones lo usan automáticamente; no hace falta volver a subirlo cada vez.
- Proveedores con configuración de IVA/moneda.
- Wizard de 4 pasos para cargar sólo la lista nueva del proveedor y compararla contra tu catálogo ya guardado.
- Matching en varios niveles: código exacto → código normalizado → equivalencia histórica confirmada → **familia de código** → descripción (fuzzy).
- Un match por código exacto o normalizado, o una equivalencia ya confirmada, se considera definitivo — no se vuelve a poner en duda por una heurística de texto sobre la presentación.
- Los cambios de precio quedan **aprobados automáticamente** en cuanto el match es confiable; sólo hace falta actuar si querés **rechazar** alguno puntual (o reincluirlo después).
- Exportación a Excel (todo, o solo los cambios aprobados).
- Backup manual (exportar/importar `.json` completo) desde la barra lateral.

### Umbrales configurables
Desde **Configuración** podés ajustar con sliders:
- A partir de qué score algo se considera "coincidencia segura" (automático).
- A partir de qué score algo se manda a "revisar" en vez de descartarse directo como "no encontrado". Por debajo de ese umbral, ni siquiera se muestra un candidato dudoso.

### "Familia de código" — mismo producto, distinta presentación
Cuando el código del proveedor no es idéntico al tuyo pero comparte una base fuerte (ej: `TOR8X1X100` vs `TOR8X1X1000`) y la descripción indica una cantidad/presentación distinta, el sistema lo marca como **"Presentación distinta"** en vez de "no encontrado" o forzar un match incorrecto. Un mismo producto interno puede terminar con varias equivalencias — una por cada presentación que vende el proveedor (x10, x100, x1000, etc.) — y eso es intencional.

### Panel de revisión ("tipo Tinder")
Desde el botón **"Revisar pendientes"** en cada comparación, se abre una cola que muestra un ítem dudoso a la vez:
- **Sí, es este** → confirma la sugerencia del algoritmo (queda en el diccionario para la próxima vez).
- **No, buscar otro** → abre una búsqueda manual sobre todo el catálogo, para elegir vos el producto correcto.
- **No existe / discontinuado** → lo marca como tal; la próxima lista del mismo proveedor va a saltear ese código automáticamente sin volver a preguntar.
- **Dejar para después** → lo saca de la ronda actual sin decidir nada; queda disponible para retomar.

Los matches ya "seguros" (código exacto, etc.) nunca entran a este panel ni muestran candidatos alternativos — sólo lo genuinamente dudoso pide tu atención.

### Resultados
- Filtros por estado, incluyendo **Discontinuados**.
- **Subieron / Bajaron** ahora sólo cuentan cambios ya aprobados o con match confirmado — un match dudoso no infla las estadísticas de aumentos.
- Orden por precio, por score de coincidencia, o alfabético.
- **Eliminar** una comparación entera (se saca del historial y del dashboard) — también disponible desde el Dashboard y el Historial.

## Estructura

```
src/
├── components/
│   ├── AppShell.tsx              # nav + backup
│   └── MatchResolutionPanel.tsx  # búsqueda manual / confirmar / discontinuar (compartido)
├── features/
│   ├── dashboard/
│   ├── suppliers/
│   ├── imports/                  # wizard de nueva comparación
│   ├── comparisons/
│   │   ├── ResultsPage.tsx        # tabla, filtros, orden, export, borrado
│   │   ├── ReviewQueue.tsx        # panel de revisión tipo Tinder
│   │   └── HistoryPage.tsx
│   ├── equivalences/              # diccionario + códigos discontinuados
│   └── settings/                  # umbrales configurables
├── lib/
│   ├── db.ts               # IndexedDB — todos los repositorios
│   ├── backup.ts
│   ├── runMatching.ts       # orquestador del pipeline (corre en el navegador)
│   ├── reviewActions.ts     # confirmar / rechazar / discontinuar (lógica compartida)
│   ├── normalize.ts         # normalización, parseDecimal, presentación, familia de código
│   ├── matching.ts          # motor de matching por niveles
│   ├── columnMapping.ts
│   ├── fileParsing.ts
│   ├── exportResults.ts
│   └── __tests__/           # 18 tests — parsing, scoring, familia de código, umbrales
└── types/database.ts
```

## Limitaciones conocidas

- Todo vive en el navegador de esa máquina — el backup `.json` es tu respaldo y tu forma de moverte a otra computadora.
- El matching corre en el hilo principal (sin Web Worker todavía) — con ~3.000 ítems no debería notarse.
- `supplier_column_config` existe en el modelo de datos pero el wizard todavía no lo usa para recordar el mapeo de columnas por proveedor entre cargas.

## Correr los tests

```bash
npm run test
```
