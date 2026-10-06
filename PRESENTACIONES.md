# Presentaciones por artículo — CompraCore

## Uso

1. Cargá tu catálogo con un código propio distinto para cada presentación (TOR100, TOR10, TORU).
2. Compará la lista del proveedor como siempre.
3. En resultados, abrí **Revisar detalle** en el artículo del proveedor. Si está en revisión, desplegá **Vendo este producto en otra presentación / varias presentaciones**. También está disponible en la cola de revisión.
4. Buscá cada artículo propio y agregalo. Indicá la cantidad que cubre el precio del proveedor y la cantidad de tu presentación.
5. Revisá el precio calculado y pulsá **Guardar relación y dejar precios pendientes**.

Ejemplo para una caja de 1000 tornillos a $10.000:

| Artículo propio | Cantidad proveedor | Cantidad propia | Divisor | Precio calculado |
| --- | ---: | ---: | ---: | ---: |
| TOR100 | 1000 | 100 | 10 | $1.000 |
| TOR10 | 1000 | 10 | 100 | $100 |
| TORU | 1000 | 1 | 1000 | $10 |

Fórmula: precio proveedor × cantidad propia / cantidad proveedor. El precio se redondea a dos decimales después de convertir.

Guardar una relación o confirmar un producto deja su precio pendiente de aprobación. Podés aprobar individualmente o aprobar los precios pendientes del filtro actual. La relación se guarda por proveedor, código proveedor y artículo propio. En nuevas listas se recuperan todas las presentaciones activas enseñadas. En resultados y Excel cada artículo propio tiene su fila y precio convertido. El precio original del proveedor queda conservado. La operación no actualiza OneSoft ni modifica el precio del catálogo.

## Editar la relación

Abrí **Revisar detalle** nuevamente. Podés cambiar cantidades, agregar artículos o quitar una presentación, y guardar. Debe quedar al menos una. El diccionario muestra las cantidades de las equivalencias; eliminarlas allí impide recuperarlas en futuras comparaciones, sin reescribir comparaciones anteriores. Para volver a una relación sin conversión, eliminá las equivalencias con cantidades del código y cargá una nueva comparación.

## Límites a verificar

- Las cantidades deben representar la misma unidad física. xU se ingresa como 1. No se infieren cantidades automáticamente.
- Confirmá que el precio de la lista corresponde a la caja completa. Si el proveedor ya cotiza por unidad, la cantidad proveedor es 1.
- Si cambia la cantidad cotizada manteniendo el mismo código, abrí Ver y corregí la relación antes de usar los resultados: el aprendizaje está asociado al código.
- Las estadísticas de coincidencia cuentan filas del proveedor; subas/bajas/sin cambios cuentan artículos propios identificados con precio válido y excluyen rechazados. Pueden superar las filas del proveedor.
- No se aplica IVA ni conversión de moneda. Se usa la moneda de la columna mapeada o del proveedor; una moneda incompatible bloquea el cambio de precio.
- El catálogo sigue requiriendo códigos propios distintos por proveedor. No se modificó ese contrato.
- El aprendizaje sigue viviendo en el navegador, como el resto de la aplicación. Los backups incluyen las relaciones y los resultados convertidos.

## Cambios técnicos

Campos opcionales de cantidades en Equivalence y snapshot matched_presentations en PriceListItem. No se reemplazan firmas existentes ni se cambia la versión/esquema de IndexedDB. Acción nueva savePresentations con transacción única para evitar escrituras parciales, validación de proveedor y productos activos, reemplazo de resultados y recálculo de estadísticas sin duplicados.

Las listas sin cantidades aprendidas siguen el pipeline anterior. Las reglas generales del diccionario se aplican a patrones literales de presentación. Las cantidades específicas enseñadas por artículo tienen prioridad. Si dos reglas coincidentes tienen distinto factor, el precio queda bloqueado con aviso.

Se corrigió readBackupFile para aceptar la versión 2 que exportBackup ya producía. En el test de familia de códigos se agregó al fixture el índice que usa producción: el algoritmo de matching no se modificó.

## Validación

- npm run build: correcto (advertencia existente de tamaño de bundle).
- npm test: 45/45 pruebas correctas.
- 7 pruebas nuevas: conversión, aprendizaje en la próxima lista, guardado repetido, edición/eliminación, validaciones y aislamiento por proveedor, backup v2 y precios sin cambio/inválidos.
- Verificación visual de la interfaz pendiente: el navegador de prueba no estuvo disponible. Antes de usar en trabajo real, probar con una lista pequeña y revisar los precios de x100, x10 y xU y el Excel exportado.

## Ejecutar el proyecto

Desde la carpeta del proyecto:

```sh
npm ci
npm run dev
```

Para compilar y probar:

```sh
npm test
npm run build
```
