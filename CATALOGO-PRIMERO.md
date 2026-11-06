# Mi catálogo contra la lista del proveedor

La comparación parte de los artículos activos de tu catálogo. La lista del proveedor se indexa una vez y se usa como universo de búsqueda. Códigos, equivalencias confirmadas, ET por proveedor y cantidades aprendidas siguen teniendo prioridad. La búsqueda por descripción se aplica a cada artículo propio, con un cupo configurable de candidatos y mayor peso para las palabras específicas del modelo.

Sólo las filas elegidas como candidatas de artículos propios pasan al motor de comparación de precios. Los productos que no vendés se conservan en el archivo original y en la vista completa, pero no generan automáticamente una tarea de revisión.

La revisión muestra **mi artículo** y debajo las opciones **del proveedor**. Incluye artículos propios sin coincidencia y permite buscar en toda la lista del proveedor, incluso en filas que ya sirven para otra presentación. En ese caso se abre el editor de cantidades, que conserva las asociaciones anteriores y precarga el artículo propio actual. Una vinculación simple no puede sobrescribir otro artículo confirmado.

«No lo encontré / dejar para después» aparta ese artículo propio en esta comparación; no marca arbitrariamente un código del proveedor como discontinuado.

Las comparaciones existentes pueden abrir la revisión en este sentido sin reimportar ni borrar decisiones: las sugerencias se calculan desde sus artículos propios pendientes y el archivo de proveedor ya guardado. El nuevo motor se aplica a las comparaciones que se procesen desde esta versión; no se recalculan ni se reemplazan automáticamente decisiones de comparaciones anteriores.

## Verificación

- Pruebas de código exacto, equivalencias, rechazo, discontinuados, ET por proveedor, variantes, duplicados del proveedor y búsqueda de un modelo al final de la lista.
- Caso de 1.800 artículos propios frente a 10.000 filas del proveedor: se seleccionan solamente los 1.800 códigos que se venden.
- Integración con una lista de 501 filas y dos artículos propios: un equivalente encontrado y un artículo propio pendiente; los 500 productos restantes no llenan la cola.
- La suite completa y la compilación se verifican en el workflow del PR.
