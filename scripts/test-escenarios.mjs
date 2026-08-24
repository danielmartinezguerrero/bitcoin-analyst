/**
 * Verificacion de lib/escenarios.mjs.
 * La aritmetica de expectativa se comprueba contra valores calculables a mano.
 */
import { construirEscenario, construirEscenarios, winRateDeEquilibrio, expectativa } from '../lib/escenarios.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

console.log('\nAritmetica de expectativa');
{
  // Valores de la literatura: R=1 -> 50%, R=2 -> 33,3%, R=3 -> 25%.
  comprobar('R:R 1:1 exige acertar el 50%', cerca(winRateDeEquilibrio(1), 0.5));
  comprobar('R:R 2:1 exige acertar el 33,3%', cerca(winRateDeEquilibrio(2), 1 / 3));
  comprobar('R:R 3:1 exige acertar el 25%', cerca(winRateDeEquilibrio(3), 0.25));
  comprobar('R:R 9:1 exige acertar el 10%', cerca(winRateDeEquilibrio(9), 0.1));

  // En el umbral exacto la expectativa es cero: ni gana ni pierde.
  for (const rr of [1, 2, 3, 5]) {
    comprobar('en el umbral de R:R ' + rr + ':1 la expectativa es 0',
      cerca(expectativa(rr, winRateDeEquilibrio(rr)), 0, 1e-9));
  }

  // Ejemplo citado en la literatura: 40% con 3:1 rinde mas que 60% con 1:1.
  const a = expectativa(3, 0.4);   // 0.4*3 - 0.6 = 0.6
  const b = expectativa(1, 0.6);   // 0.6*1 - 0.4 = 0.2
  comprobar('40% con R:R 3:1 supera a 60% con R:R 1:1', a > b,
    a.toFixed(2) + 'R vs ' + b.toFixed(2) + 'R');
  comprobar('por debajo del umbral la expectativa es negativa',
    expectativa(3, 0.2) < 0, expectativa(3, 0.2).toFixed(2) + 'R');
}

// Zonas de prueba alrededor de un precio de 77.000 con ATR de 2.000.
const NIVELES = [
  { precio: 83000, toques: 3, fuerza: 40 },
  { precio: 88000, toques: 2, fuerza: 25 },
  { precio: 74000, toques: 4, fuerza: 55 },
  { precio: 70000, toques: 5, fuerza: 70 },
];

console.log('\nInvalidacion hibrida (estructura + suelo de ATR)');
{
  const e = construirEscenario('alcista', 77000, 2000, NIVELES, 0.5);
  // Soporte mas cercano 74.000, menos 0,25 ATR = 73.500.
  comprobar('el stop se apoya en el soporte mas cercano con colchon',
    cerca(e.invalidacion.precio, 73500), String(e.invalidacion.precio));
  comprobar('declara en que se baso', e.invalidacion.base === 'estructura', e.invalidacion.base);
  comprobar('guarda el nivel de origen para poder auditarlo',
    e.invalidacion.nivelOrigen === 74000);

  // Soporte pegadisimo al precio: el suelo de 1 ATR debe apartarlo.
  const pegado = [{ precio: 76800, toques: 2, fuerza: 30 }, ...NIVELES];
  const p = construirEscenario('alcista', 77000, 2000, pegado, 0.5);
  comprobar('un soporte dentro del ruido se sustituye por el suelo de 1 ATR',
    cerca(p.invalidacion.precio, 75000), String(p.invalidacion.precio));
  comprobar('y lo declara en la base', p.invalidacion.base.startsWith('suelo'), p.invalidacion.base);
  comprobar('y lo advierte explicitamente',
    p.advertencias.some((a) => a.includes('ruido')));
  comprobar('el stop nunca queda a menos de 1 ATR', p.invalidacion.distanciaATR >= 1);

  const corto = construirEscenario('bajista', 77000, 2000, NIVELES, -0.5);
  // Resistencia mas cercana 83.000, mas 0,25 ATR = 83.500.
  comprobar('en corto el stop se apoya en la resistencia',
    cerca(corto.invalidacion.precio, 83500), String(corto.invalidacion.precio));
  comprobar('en corto el stop queda POR ENCIMA del precio', corto.invalidacion.precio > 77000);
}

console.log('\nObjetivos y ratios');
{
  const e = construirEscenario('alcista', 77000, 2000, NIVELES, 0.5);
  comprobar('los objetivos van en la direccion del escenario',
    e.objetivos.every((o) => o.precio > 77000));
  comprobar('salen ordenados del mas cercano al mas lejano',
    e.objetivos.every((o, i) => i === 0 || e.objetivos[i - 1].precio < o.precio));

  // riesgo = 77000 - 73500 = 3500; objetivo 83000 -> recorrido 6000 -> R:R 1,71
  comprobar('el R:R se calcula sobre el riesgo real del escenario',
    cerca(e.objetivos[0].rr, Number((6000 / 3500).toFixed(2)), 0.01),
    String(e.objetivos[0].rr));
  // AUDITABILIDAD: el umbral publicado debe reproducirse exactamente a partir
  // del R:R publicado, no de un valor interno con mas decimales.
  comprobar('el umbral se reproduce exactamente desde el R:R que se muestra',
    e.objetivos.every((o) => cerca(o.winRateMinimoPct / 100, winRateDeEquilibrio(o.rr), 0.0005)));

  const ultimo = e.objetivos[e.objetivos.length - 1];
  comprobar('a mayor objetivo, mayor R:R y menor acierto exigido',
    ultimo.rr > e.objetivos[0].rr && ultimo.winRateMinimoPct < e.objetivos[0].winRateMinimoPct,
    e.objetivos.map((o) => o.rr + ':1 -> ' + o.winRateMinimoPct + '%').join('  '));

  // Sin zonas por encima: proyeccion por ATR, debidamente etiquetada.
  const soloAbajo = NIVELES.filter((n) => n.precio < 77000);
  const sin = construirEscenario('alcista', 77000, 2000, soloAbajo, 0.5);
  comprobar('sin zonas historicas proyecta por ATR',
    sin.objetivos.every((o) => o.origen.startsWith('proyeccion')));
  comprobar('y advierte de que no son niveles observados',
    sin.advertencias.some((a) => a.includes('proyecciones')));
}

console.log('\nAmbas direcciones, siempre');
{
  const analisisRef = {
    temporalidad: '1d',
    precio: 77000,
    indicadores: { atr14: 2000 },
    niveles: {
      resistencias: NIVELES.filter((n) => n.precio > 77000),
      soportes: NIVELES.filter((n) => n.precio < 77000),
    },
  };
  const r = construirEscenarios(analisisRef, { puntuacion: 0.54 });

  comprobar('se construyen dos escenarios, no uno', r.escenarios.length === 2);
  comprobar('uno alcista y uno bajista',
    r.escenarios.some((e) => e.direccion === 'alcista')
      && r.escenarios.some((e) => e.direccion === 'bajista'));

  const alcista = r.escenarios.find((e) => e.direccion === 'alcista');
  const bajista = r.escenarios.find((e) => e.direccion === 'bajista');
  comprobar('con sesgo positivo, el alcista queda marcado como alineado',
    alcista.alineadoConSesgo === true);
  comprobar('y el bajista como no alineado', bajista.alineadoConSesgo === false);
  comprobar('el no alineado se advierte para evitar sesgo de confirmacion',
    bajista.advertencias.some((a) => a.includes('EN CONTRA')));

  const inv = construirEscenarios(analisisRef, { puntuacion: -0.54 });
  comprobar('con sesgo negativo se invierte la alineacion',
    inv.escenarios.find((e) => e.direccion === 'bajista').alineadoConSesgo === true);

  comprobar('el resultado declara que la tasa de acierto no esta medida',
    r.limitacion.includes('no ha sido medida'));
  comprobar('todo escenario declara su condicion de activacion',
    r.escenarios.every((e) => typeof e.activacion === 'string' && e.activacion.length > 10));
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
