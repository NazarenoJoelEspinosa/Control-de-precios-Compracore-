# Resultados de comparación

La pantalla separa dos preguntas:

- **Qué artículos son:** el avance superior cuenta artículos propios únicos, con vínculos confirmados, por confirmar o aún sin vínculo. Esos tres grupos completan el catálogo activo del proveedor.
- **Qué hacer con los precios:** las pestañas cuentan resultados por fila y presentación. Un artículo propio puede tener varios resultados; no se deben restar esos números del total de artículos propios.

## Recorrido

1. **Por revisar:** identificar el artículo, confirmar cantidades o corregir precio/moneda. Cada resultado tiene un único próximo paso. Identificación y presentación ya no comparten la misma cola.
2. **Listos para aprobar:** precios válidos, con identidad y presentación resueltas, que todavía necesitan decisión.
3. **Aprobados:** los mismos resultados que se incluyen en el botón «Exportar N precios aprobados».
4. **Sin cambios:** precios iguales al anterior, incluida la conversión de cantidades. No necesitan aprobación y no se exportan como cambios.
5. **Lista completa:** todos los resultados, incluidos artículos del proveedor que no vendés. Los rechazados y discontinuados se consultan mediante los filtros adicionales.

Se abre primero la primera pestaña con trabajo disponible. Una actualización del resultado no cambia la pestaña elegida por el usuario.

Los accesos duplicados de cabecera y las cinco tarjetas de avance se reemplazan por el resumen de artículos y las pestañas. «Más acciones» reúne exportación completa, finalizar y eliminar. La configuración del proveedor queda plegada. La tabla muestra un estado y una acción principal por resultado; el porcentaje de coincidencia, el rechazo y la edición de cantidades siguen en el detalle.

Las reglas de matching y los límites configurados no se modifican. Confirmar cantidades sigue dejando los precios pendientes de aprobación.

## Verificación

- Pruebas específicas para identificación frente a aprobación, ausencia de cambios con/sin registro de precio, conversiones, cero diferencias, revisión exclusiva, subas grandes, rechazados y coherencia del Excel exportado.
- Doce comprobaciones de interfaz con datos ficticios: 194 artículos propios y 2.215 filas del proveedor, filtros, rechazo, deshacer, cola de presentaciones y acciones secundarias.
- Revisión visual a 1440×1000 y 390×844 sin desbordamiento horizontal de la página.
- La suite completa y la compilación se verifican en el workflow del PR.
