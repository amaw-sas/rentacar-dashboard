-- Migration: Populate category display data (group_label, short_description, long_description, tags)
-- Source: Legacy useVehicleCategories.ts composable
-- These values drive the public-facing category cards and detail pages.

UPDATE vehicle_categories SET
  group_label = 'Económico',
  short_description = 'Compacto mecánico',
  long_description = 'Vehículos pequeños y ágiles, perfectos para desplazarse por la ciudad de manera eficiente y económica. Ideales para personas que buscan el menor costo en alquiler y consumo. Sin embargo, su espacio interior y capacidad de carga son limitados, lo que los hace más adecuados para trayectos urbanos y usuarios individuales o parejas.',
  tags = '["Transmisión manual","Capacidad: 4-5 personas","1 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios manuales","Cierre centralizado básico"]'
WHERE code = 'C';

UPDATE vehicle_categories SET
  group_label = 'Económico',
  short_description = 'Económico Automático',
  long_description = 'Vehículo compacto con transmisión automática, ideal para desplazamientos urbanos con máxima comodidad. Equipado con dirección asistida eléctrica, aire acondicionado, vidrios eléctricos y un completo paquete de seguridad con 6 airbags y frenos ABS. Su tamaño compacto facilita el estacionamiento y su bajo consumo lo hace perfecto para quienes buscan economía sin sacrificar confort ni tecnología.',
  tags = '["Transmisión Automática","Capacidad: 5 personas","1 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Dirección asistida eléctrica","6 airbags","Frenos ABS"]'
WHERE code = 'CX';

UPDATE vehicle_categories SET
  group_label = 'Económico',
  short_description = 'Compacto mecánico',
  long_description = 'Vehículos pequeños y ágiles, perfectos para desplazarse por la ciudad de manera eficiente y económica. Ideales para personas que buscan el menor costo en alquiler y consumo. Sin embargo, su espacio interior y capacidad de carga son limitados, lo que los hace más adecuados para trayectos urbanos y usuarios individuales o parejas.',
  tags = '["Transmisión manual","Capacidad: 4-5 personas","1 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios manuales","Cierre centralizado básico"]'
WHERE code = 'FL';

UPDATE vehicle_categories SET
  group_label = 'Económico',
  short_description = 'Sedán mecánico',
  long_description = 'Sedanes cómodos y funcionales que ofrecen un equilibrio entre economía y espacio. Son ideales para familias pequeñas, parejas o viajeros frecuentes que buscan mayor comodidad que un compacto, sin elevar demasiado los costos. Su maletero amplio los hace perfectos para viajes cortos o medianos. Pueden carecer de las comodidades avanzadas de gamas superiores.',
  tags = '["Transmisión manual","Capacidad: 5 personas","2 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vídrios electricos en las puertas delanteras","Cierre centralizado"]'
WHERE code = 'F';

UPDATE vehicle_categories SET
  group_label = 'Intermedio',
  short_description = 'Sedan automático',
  long_description = 'Conducción automática y gran versatilidad, estos sedanes ofrecen comodidad y facilidad de manejo, ideales tanto para uso urbano como para viajes. Son una opción intermedia que combina eficiencia con un costo razonable. Aunque tienen buen espacio interior, su maletero puede ser limitado para quienes necesitan transportar mayor equipaje.',
  tags = '["Transmisión Automática","Capacidad: 5 personas","2 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Cierre centralizado"]'
WHERE code = 'FX';

UPDATE vehicle_categories SET
  group_label = 'Intermedio',
  short_description = 'Sedan automático',
  long_description = 'Conducción automática y gran versatilidad, estos sedanes ofrecen comodidad y facilidad de manejo, ideales tanto para uso urbano como para viajes. Son una opción intermedia que combina eficiencia con un costo razonable. Aunque tienen buen espacio interior, su maletero puede ser limitado para quienes necesitan transportar mayor equipaje.',
  tags = '["Transmisión Automática","Capacidad: 5 personas","2 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Cierre centralizado"]'
WHERE code = 'FU';

UPDATE vehicle_categories SET
  group_label = 'Intermedio',
  short_description = 'Camioneta automática',
  long_description = 'Camionetas compactas con bajo consumo y facilidad de manejo, ideales para la ciudad. Diseñadas para quienes necesitan la comodidad de una camioneta pero con dimensiones y costos accesibles. Aunque prácticas, su espacio interior y maletero son moderados, haciéndolas menos adecuadas para viajes familiares largos o con mucho equipaje.',
  tags = '["Transmisión Automática","Capacidad: 5 personas","2 maleta grande, 2 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Cierre centralizado"]'
WHERE code = 'GC';

UPDATE vehicle_categories SET
  group_label = 'Intermedio',
  short_description = 'Camioneta mecánica 4x4',
  long_description = 'Robustas y confiables, estas camionetas están diseñadas para enfrentar terrenos difíciles y aventuras al aire libre. Ideales para quienes buscan un vehículo resistente para actividades fuera de carretera. Aunque su consumo de combustible es mayor y su confort puede ser básico, compensan con su capacidad todoterreno.',
  tags = '["Transmisión manual","Capacidad: 5 personas","3 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Cierre centralizado"]'
WHERE code = 'G4';

UPDATE vehicle_categories SET
  group_label = 'Intermedio',
  short_description = 'Camioneta mecánica 4x4',
  long_description = 'Robustas y confiables, estas camionetas están diseñadas para enfrentar terrenos difíciles y aventuras al aire libre. Ideales para quienes buscan un vehículo resistente para actividades fuera de carretera. Aunque su consumo de combustible es mayor y su confort puede ser básico, compensan con su capacidad todoterreno.',
  tags = '["Transmisión manual","Capacidad: 5 personas","3 maleta grande, 1 maleta pequeña","Aire acondicionado","Eleva vidrios eléctricos","Cierre centralizado"]'
WHERE code = 'GL';

UPDATE vehicle_categories SET
  group_label = 'Prémium',
  short_description = 'Camioneta automática de lujo',
  long_description = 'Vehículos premium con acabados de alta calidad y tecnología avanzada. Perfectas para quienes priorizan el confort, el espacio amplio y las prestaciones superiores. Son ideales para viajes largos o usuarios que buscan un toque de exclusividad. Su costo de alquiler y consumo son más altos, pero ofrecen una experiencia superior.',
  tags = '["Transmisión Automática","Capacidad: 5 personas","4 maleta grande, 2 maleta pequeña","Aire acondicionado automático de doble zona","Eleva vidrios eléctricos","Cierre centralizado con acceso sin llave"]'
WHERE code = 'LE';

UPDATE vehicle_categories SET
  group_label = 'Prémium',
  short_description = 'SUV Automática 7 puestos',
  long_description = 'SUV espaciosa con transmisión automática y capacidad para 7 pasajeros, ideal para familias o grupos. Equipada con motor 1.6 turbo, dirección asistida eléctrica, aire acondicionado, vidrios eléctricos y 7 airbags (frontales, laterales y cortina). Frenos ABS y 5 puertas.',
  tags = '["Transmisión Automática","Capacidad: 7 personas","Aire acondicionado","Eleva vidrios eléctricos","Dirección asistida eléctrica","7 airbags","Frenos ABS","5 puertas"]'
WHERE code = 'GY';

UPDATE vehicle_categories SET
  group_label = 'Prémium',
  short_description = 'Camioneta automática 7 puestos',
  long_description = 'Camionetas espaciosas con capacidad para 7 pasajeros, ideales para familias numerosas o grupos. Ofrecen gran versatilidad, potencia y comodidad para múltiples usos, desde actividades al aire libre hasta largos viajes. Su costo de alquiler y consumo de combustible son elevados, pero su capacidad y prestaciones lo compensan.',
  tags = '["Transmisión Automática","Capacidad: 7 personas","4 maleta grande o 2 maleta grandes con los 7 asientos ocupados","Aire acondicionado de triple zona","Eleva vidrios eléctricos","Cierre centralizado con acceso sin llave"]'
WHERE code = 'GR';
