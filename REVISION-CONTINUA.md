# CompraCore: revisión continua

Este proyecto incluye las mejoras de revisión de faltantes, códigos ET por proveedor, enseñanza de presentaciones y filtros simplificados.

## Ejecutar

```bash
npm ci
npm run dev
```

## Encontrar artículos de mi catálogo

En una comparación, abrí «Encontrar los … de mi catálogo».

- Lista y búsqueda visibles a la vez, con desplazamiento independiente en escritorio.
- «Vincular y seguir» guarda la equivalencia y abre el siguiente artículo. El precio queda pendiente de aprobación.
- «Dejar para después» permite apartar un artículo y retomarlo desde su filtro. No lo marca como encontrado ni discontinuado.
- «Anterior», «Siguiente» y Alt + flechas permiten navegar.
- La posición, las búsquedas por artículo y los apartados se guardan en este navegador por comparación. No forman parte del backup de la base.
- Guardar actualiza en segundo plano: no reemplaza la pantalla por «Cargando…».

## Códigos con/sin ET-, sólo para un proveedor

La regla está desactivada por defecto. Se puede activar desde Proveedores → Editar o directamente en la revisión de faltantes con «Reconocer ET- sólo para este proveedor».

Las comparaciones nuevas reconocen `ET-ABC123` y `ABC123` en ambos sentidos cuando la regla está activada. Conservan los códigos originales y respetan la prioridad de códigos completos y equivalencias confirmadas. No recortan prefijos desconocidos, letras pegadas al modelo ni ceros iniciales.

En comparaciones existentes, «Aplicar a esta comparación» resuelve faltantes inequívocos sin reimportar ni crear otra sesión. Omite ambigüedades, cantidades distintas, discontinuados, rechazos aprendidos y decisiones anteriores. La operación es transaccional y los nuevos precios quedan pendientes.

Se reprodujo el caso `EWCB21005` frente a `ET-EWCB21005`.

## Revisar presentaciones

Abrí «Revisar presentaciones (N)», la tarjeta «Presentaciones a revisar» o el botón de la fila «Revisar presentación» / «Enseñar presentación».

- Lista y editor juntos, con navegación anterior/siguiente y «Guardar y seguir».
- Vista de producto propio y proveedor, precio original, cantidades, precio convertido y cambio real antes de guardar.
- El artículo identificado se carga automáticamente. Las cantidades explícitas del texto pueden precargarse; se revisan y confirman manualmente. No se deducen cantidades por el precio.
- Se pueden agregar varias presentaciones propias (x100, x10, xU, etc.) para el mismo código del proveedor.
- «Dejar para después» y su filtro permiten retomar artículos pendientes. La posición y los apartados se guardan en este navegador.
- Si el aumento es real y la presentación no cambió, confirmá la relación 1 → 1.
- Guardar recuerda la relación para ese proveedor, recalcula esta comparación y deja los precios pendientes de aprobación.

### Avisos por diferencias grandes

Sin una presentación confirmada, una suba desde 100% o una baja desde 50% aparece como posible diferencia de caja/pack/unidad. Es un aviso, no una conversión automática. También se incluyen las presentaciones distintas detectadas al identificar.

El producto puede seguir identificado por código exacto; la decisión sobre su precio se revisa por separado. Estos casos no se aprueban automáticamente, no se incluyen en la aprobación por lote y se excluyen de «Exportar solo aprobados» hasta confirmar la presentación. Esto también protege comparaciones antiguas, aunque sus precios hubieran quedado aprobados antes. «Exportar todo» conserva el dato y agrega el aviso.

Caso probado de la captura: $10.629,45 por x50 → $212,59 por unidad frente a $212,58 anteriores: diferencia $0,01.

## Filtros

Cuatro pestañas: «Por revisar», «Precios pendientes», «Aprobados» y «Todos».

En «Por revisar» se elige presentación, identificación del producto o errores de precio/moneda. «Más filtros» conserva subieron, bajaron, rechazados, discontinuados y otros estados. Se combina con la pestaña y la búsqueda actual. Cambiar de pestaña limpia el filtro adicional para evitar resultados vacíos por una combinación anterior.

Los artículos del proveedor que no pertenecen al catálogo no llenan automáticamente la revisión humana. Siguen accesibles desde «Todos» → «Más filtros».

## Validación

```bash
npm test
npm run build
```

87 pruebas correctas y compilación de producción correcta. Vite informa el aviso de tamaño de algunos archivos generados (bibliotecas Excel).

Se comprobó la interfaz con Chromium a 1440×1000 y 390×844, usando datos de prueba: cuatro pestañas, filtros combinados, apertura de presentaciones, cantidades x50/x1, precio convertido, guardar y avanzar, conservación del desplazamiento, apartar/retomar y ausencia de desbordamiento horizontal en móvil.

El ZIP contiene el código fuente completo; no incluye dependencias instaladas ni archivos temporales del navegador de pruebas.
