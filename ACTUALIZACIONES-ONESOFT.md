# Actualizaciones desde OneSoft

Cada comparación nueva pide una exportación actual del catálogo propio antes de cargar la lista del proveedor.

1. Elegí el proveedor existente; no hace falta borrarlo ni volverlo a crear.
2. Subí tu exportación de OneSoft y elegí si contiene la lista completa de ese proveedor o una sublista.
3. Revisá los artículos nuevos, actualizados y ausentes. Una lista completa deja a los ausentes inactivos; una sublista mantiene los demás artículos.
4. Si cambiaste un código o descripción, podés elegir explícitamente el artículo anterior de la misma presentación. Se conserva su identificador y sus equivalencias y cantidades aprendidas. Las presentaciones diferentes, como x1 y x2, se cargan por separado y requieren enseñanza.
5. Guardá el catálogo, cargá la lista del proveedor y revisá los resultados.
6. Exportá los precios que necesites y usá **Finalizar comparación**. Los pendientes quedan sin aprobar. El cierre no actualiza OneSoft ni da por aplicado el Excel exportado.

Las comparaciones finalizadas quedan disponibles para consulta y exportación. Las nuevas conservan una copia del catálogo usado, de modo que posteriores cambios de código, descripción o precio no alteren ese historial. Las comparaciones anteriores sin copia guardada toman el catálogo disponible al finalizarlas; no se puede reconstruir información que ya se hubiera sobrescrito.

Antes de renovar un catálogo, deben finalizarse las comparaciones abiertas de ese proveedor. Las equivalencias y presentaciones se conservan. La renovación invalida las acciones de deshacer anteriores de ese proveedor, que correspondían a otra versión del catálogo.

Las filas repetidas de código y presentación se bloquean antes de guardar. Si el catálogo cambió en otra pantalla desde la vista previa, se solicita volver a cargar el archivo. La renovación se guarda en una transacción.

## Proveedores en papelera

Los proveedores en papelera no aparecen en Catálogo ni en Nueva comparación. Desde Papelera se pueden restaurar o eliminar definitivamente. La eliminación definitiva pide confirmación y borra el catálogo, listas, comparaciones, equivalencias, cantidades, reglas y configuración de ese proveedor. No afecta a los demás proveedores y no admite deshacer.

## Validación de esta entrega

- 29 comprobaciones de integración ejecutadas en Chrome con IndexedDB nativo y Worker real: listas completas/parciales, duplicados, cambio de código, cantidades distintas, conservación de memoria, cierre, historial, backup y eliminación aislada por proveedor.
- Comprobación TypeScript del código de producción y compilación Vite correctas.
- 27 pruebas existentes de matching y exportación correctas. Se verificó el asistente completo desde la carga de ambos CSV hasta finalizar y exportar, y la ausencia de proveedores en papelera en Catálogo. Interfaz revisada a 1440×1000 y 390×844, sin desbordamiento horizontal en la carga de catálogo.
- La prueba equivalente está en `src/lib/__tests__/catalogLifecycle.test.ts`, para ejecutarse junto al resto con `npm test`.
- En el entorno de edición faltan `fake-indexeddb` y `react-test-renderer` en la caché disponible. Por eso no se pudo ejecutar la suite completa de Vitest ni el comando conjunto `npm run build` que incluye los archivos de pruebas. No se modificaron dependencias ni se excluyeron pruebas de la configuración del proyecto.
