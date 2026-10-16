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

101 pruebas correctas y compilación de producción correcta. Vite informa el aviso de tamaño de algunos archivos generados (bibliotecas Excel).

Se comprobó la interfaz con Chromium a 1440×1000 y 390×844, usando datos de prueba: cuatro pestañas, filtros combinados, apertura de presentaciones, cantidades x50/x1, precio convertido, guardar y avanzar, conservación del desplazamiento, apartar/retomar y ausencia de desbordamiento horizontal en móvil.

El ZIP contiene el código fuente completo; no incluye dependencias instaladas ni archivos temporales del navegador de pruebas.


## Mejoras de control y seguimiento

### Deshacer

La barra «Última acción» permite revertir hasta 20 acciones en orden inverso. Se guardan en IndexedDB y persisten al cerrar el navegador. Se registran vinculaciones, rechazos de coincidencia, discontinuados, enseñanza de presentaciones, aprobación/rechazo de precios por artículo o lote, aplicación ET, edición del proveedor, reglas del diccionario y cambios/eliminaciones de relaciones aprendidas.

La restauración incluye los registros afectados de precios, equivalencias, ítems y contadores, en una sola transacción. Si otro cambio modificó esos datos después, se bloquea la restauración en lugar de sobrescribirlo. Deshacer actualiza la pantalla sin recargar toda la aplicación.

No es un historial universal: las importaciones de catálogo y la creación/eliminación de comparaciones no se revierten con esta barra. Importar un backup invalida el historial reversible anterior; los backups conservan los datos del negocio, no las 20 acciones de deshacer.

### Resumen de avance

«Tu avance» muestra artículos propios identificados, grupos de presentaciones por revisar, faltantes propios, precios listos para aprobar y precios aprobados. Cada cifra lleva a su sección. La barra cuenta artículos propios únicos; una fila del proveedor puede identificar tres artículos propios. Los contadores originales del proveedor están en «Datos de la lista del proveedor».

### Límites por proveedor

Proveedores → Editar permite establecer el porcentaje de suba y baja que dispara la revisión de presentación. Por defecto: suba desde 100% y baja desde 50%. Los valores deben ser positivos y la baja menor de 100%.

Las nuevas comparaciones guardan una copia de esos límites. Para actualizar una comparación existente: «Tu avance» → «Límites de los avisos de precio» → «Actualizar límites del proveedor». Esa aplicación también se puede deshacer. Las cantidades previamente confirmadas no cambian.

### Diccionario editable

«Relaciones por artículo» muestra código, presentación, conversión y fecha de actualización. «Editar cantidades» modifica esa relación para próximas listas; «Olvidar relación» la elimina para próximas listas. Ambas operaciones admiten deshacer. Para recalcular una comparación existente, abrí «Enseñar presentación» en esa comparación y guardá la relación.

### Motivos de pendientes

La revisión de faltantes explica si no hay coincidencias por código, hay varias filas candidatas, falta activar ET, existe un rechazo/discontinuado o la fila del proveedor ya está asociada a otra presentación propia. Cuando corresponde, «Enseñar presentaciones de esta fila» permite agregar variantes sin quitar la asociación anterior.

## Un código del proveedor, varias presentaciones propias

Se conserva una relación de uno a varios: proveedor x1000 → propios x100, x10 y x1. También funciona si los tres artículos propios comparten exactamente el mismo código.

La base se actualiza a v6 sin borrar los registros existentes de v5. El índice de código del catálogo deja de exigir unicidad; las presentaciones conservan identificadores internos independientes. La importación actualiza por código y presentación y sólo colapsa filas repetidas de la misma variante. Cuando no hay cantidad explícita en la columna unidad, se usa también la descripción para distinguirlas y evitar sobrescribir filas distintas.

Sin una relación enseñada, el motor deriva los códigos con varias presentaciones a revisión en lugar de elegir un artículo arbitrario. El editor precarga esas variantes para confirmar sus cantidades. La cantidad del proveedor se comparte entre filas: modificarla actualiza las demás; cada variante propia conserva su cantidad.

Ejemplo con caja x1000 a $10.000:

| Mi presentación | Cálculo | Precio |
| --- | --- | --- |
| x100 | 10.000 × 100 / 1000 | $1.000 |
| x10 | 10.000 × 10 / 1000 | $100 |
| x1 | 10.000 × 1 / 1000 | $10 |

Guardar crea tres precios pendientes y recuerda las tres relaciones para próximas listas de ese proveedor. Si antes sólo existía una relación aprendida, «Agregar las otras presentaciones de este código» permite sumar las restantes.

Si una importación anterior a esta versión había sobrescrito variantes y dejó un solo artículo, las otras deben recuperarse reimportando la lista propia: la actualización no puede reconstruir filas que ya no estaban guardadas.

### Verificación adicional

Se ejecutaron 101 pruebas, incluidas migración v5→v6, importación de códigos repetidos con variantes, actualización de precios sin perder IDs, backup de las variantes, tres conversiones desde una fila, deshacer de enseñanza y aprobación, validación de conflictos posteriores, límite de 20 acciones, edición del diccionario, límites por proveedor y motivos de faltantes.

En Chromium se verificó el flujo completo con Worker: proveedor ET-TOR001 x1000 y tres propios TOR001 x100/x10/x1, enseñanza, aprobación y deshacer, edición de memoria y deshacer, aplicación de límites y deshacer, y resumen adaptable a escritorio y móvil.
