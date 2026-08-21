# PriceCore — MVP (versión local, sin backend)

Herramienta interna para comparar listas de precios de proveedores contra el catálogo propio, con matching por niveles, revisión humana obligatoria para lo dudoso, y exportación a Excel para actualizar el sistema de gestión manualmente. No se conecta ni modifica ningún sistema externo — y, en esta versión, **no depende de ningún servidor**: todo corre en tu navegador.

Ver `/PriceCore_Fase1_Analisis.md` (entregado antes que el código) para el análisis completo de CompraCore y las decisiones de arquitectura originales. Algunas de esas decisiones (Supabase/Postgres) fueron reemplazadas después por este enfoque 100% local — más simple de operar para un solo usuario y sin límites de plan gratuito de ningún proveedor cloud.

## Por qué no tiene backend

La versión original usaba Supabase (Postgres + Auth + Storage + Edge Functions). Al toparse con el límite de proyectos gratis, y repensando el caso de uso real — una sola persona, en una sola máquina, procesando listas de a una por vez — se decidió sacar el backend por completo:

- **Todos los datos viven en IndexedDB**, la base de datos que trae el navegador. No hay login, no hay nube, no hay factura de ningún servicio.
- **El matching corre en el navegador** (antes vivía en una Edge Function). Con hasta ~3.000 ítems por lista tarda 1-2 segundos.
- **El "diccionario de equivalencias"** y el catálogo de productos persisten solos entre sesiones — no hace falta volver a cargarlos cada vez.
- **Backup manual**: un botón exporta todo a un `.json` descargable, y otro lo restaura. Sirve como respaldo y como forma de mover la herramienta a otra computadora si hiciera falta (IndexedDB no viaja sola entre máquinas).

## Puesta en marcha

```bash
npm install
npm run dev
```

Abrí `http://localhost:5173`. No hay variables de entorno que configurar, no hay cuenta que crear.

Para dejarla corriendo de forma más permanente (por ejemplo, abrirla como un ícono en el escritorio), `npm run build` genera una carpeta `dist/` que se puede abrir directamente en el navegador o servir con cualquier servidor estático.

## Qué está funcionando end-to-end

- CRUD de proveedores con configuración de IVA/moneda por proveedor.
- Wizard de 5 pasos: proveedor → lista nueva → precios actuales (opcional) → mapeo de columnas → procesar.
- Parsing de XLSX/CSV con detección automática de fila de encabezado.
- Sugerencia automática de mapeo de columnas por alias (nunca se aplica sin confirmación del usuario).
- Matching en 4 niveles (código exacto → normalizado → equivalencia histórica → descripción fuzzy), corriendo en el navegador.
- Detección de diferencia de presentación (cantidad/tipo/medida).
- Parsing numérico robusto (formato argentino, símbolos de moneda) — con **13 tests unitarios** cubriendo específicamente los casos de falso positivo que el brief original marca como críticos.
- Dashboard con totales agregados de las últimas sesiones.
- Resultados con filtros, búsqueda, selección masiva, aprobación/rechazo individual y masivo.
- **Exportación a Excel**: todo el resultado, o solo los cambios aprobados (el archivo que efectivamente se usa para actualizar el sistema de gestión).
- Confirmar/rechazar un match dudoso desde el drawer de detalle → escribe en el diccionario de equivalencias, que se usa automáticamente en la próxima comparación con ese proveedor.
- Historial de comparaciones.
- Diccionario de equivalencias (ver/eliminar relaciones confirmadas).
- Backup manual (exportar/importar `.json` completo).

## Qué queda pendiente / limitaciones conocidas

- **Un solo navegador, una sola máquina por defecto.** Si necesitás usarla desde otra computadora, exportá el backup y luego importalo ahí — no hay sincronización automática.
- **Borrar los datos del navegador (o del sitio) borra todo.** El backup es tu única red de seguridad; conviene exportar uno después de cada comparación importante.
- **`supplier_column_config` no se usa todavía** para pre-rellenar el mapeo de columnas la próxima vez que cargues una lista del mismo proveedor — hoy el mapeo se sugiere solo por alias genéricos cada vez. Es una mejora simple de agregar sobre `src/lib/db.ts` si se vuelve repetitivo.
- **Umbrales de matching fijos** (`SAFE_MIN = 97`, `REVIEW_MIN = 70` en `src/lib/matching.ts`) — calibrarlos con tus propios datos reales es un ajuste de una línea si hace falta.
- **Sin Web Worker todavía.** El matching corre en el hilo principal; con ~3.000 ítems no debería notarse, pero si algún día cargás listas mucho más grandes, es la primera optimización a hacer (la lógica ya es pura/aislada en `runMatching.ts`, así que mover a un worker no requiere reescribirla).

## Estructura

```
src/
├── components/       # AppShell (con backup), badges de estado
├── features/
│   ├── dashboard/
│   ├── suppliers/
│   ├── imports/        # wizard de nueva comparación
│   ├── comparisons/     # resultados + historial
│   └── equivalences/    # diccionario
├── lib/
│   ├── db.ts             # capa de IndexedDB — reemplaza al cliente de backend
│   ├── backup.ts          # exportar/importar todo a JSON
│   ├── runMatching.ts     # orquestador del pipeline de matching (corre en el navegador)
│   ├── normalize.ts       # normalización, parseDecimal, presentación (portado de CompraCore)
│   ├── matching.ts        # motor de matching por niveles + scoring de descripción
│   ├── columnMapping.ts   # alias de columnas para el mapeo automático
│   ├── fileParsing.ts     # lectura de XLSX/CSV
│   ├── exportResults.ts   # exportación a Excel (todo / solo aprobados)
│   └── __tests__/         # tests del núcleo de matching/parsing
└── types/database.ts      # tipos TS del modelo de datos
```

## Correr los tests

```bash
npm run test
```
