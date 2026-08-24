/**
 * Verificacion de lib/costes.mjs. Todas las cifras se pueden rehacer a mano.
 */
import { PERFILES, costesOperacion, escenarioNeto, recorridoMinimo, expectativaNeta } from '../lib/costes.mjs';

let pasados = 0, fallados = 0;
function comprobar(nombre, condicion, detalle = '') {
  if (condicion) { pasados++; console.log('  ok   ' + nombre); }
  else { fallados++; console.log('  FALLO ' + nombre + (detalle ? '  -> ' + detalle : '')); }
}
const cerca = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log('\nTarifas de los perfiles');
{
  comprobar('spot VIP0 = 0,1% ambos lados',
    PERFILES['spot'].comisionMaker === 0.001 && PERFILES['spot'].comisionTaker === 0.001);
  comprobar('spot con BNB aplica el 25% de descuento',
    cerca(PERFILES['spot-bnb'].comisionTaker, 0.001 * 0.75));
  comprobar('futuros maker 0,02% y taker 0,05%',
    PERFILES['futuros'].comisionMaker === 0.0002 && PERFILES['futuros'].comisionTaker === 0.0005);
  comprobar('futuros con BNB aplica el 10% de descuento',
    cerca(PERFILES['futuros-bnb'].comisionTaker, 0.0005 * 0.9, 1e-9));
  comprobar('el spot no paga funding', PERFILES['spot'].funding === null);
  comprobar('los futuros si pagan funding', PERFILES['futuros'].funding > 0);
}

console.log('\nAsimetria ganar/perder');
{
  const c = costesOperacion('futuros', { entradaComoMaker: false });
  comprobar('salir en stop cuesta mas que salir en objetivo',
    c.salidaSL > c.salidaTP, c.salidaSL + ' vs ' + c.salidaTP);
  comprobar('el stop paga taker + deslizamiento',
    cerca(c.salidaSL, PERFILES['futuros'].comisionTaker + PERFILES['futuros'].deslizamiento));
  comprobar('el objetivo paga solo maker',
    cerca(c.salidaTP, PERFILES['futuros'].comisionMaker));
  comprobar('perder cuesta mas que ganar', c.totalSiPierde > c.totalSiGana);

  const maker = costesOperacion('futuros', { entradaComoMaker: true });
  comprobar('entrar como maker abarata la entrada', maker.entrada < c.entrada);
  comprobar('y elimina el deslizamiento de entrada', maker.deslizamientoEntrada === 0);
}

console.log('\nFunding');
{
  const corta = costesOperacion('futuros', { horasEnPosicion: 3 });
  comprobar('menos de 8 horas -> ningun periodo de funding',
    corta.periodosFunding === 0 && corta.funding === 0);
  const larga = costesOperacion('futuros', { horasEnPosicion: 25 });
  comprobar('25 horas -> tres periodos', larga.periodosFunding === 3);
  comprobar('el coste escala con los periodos',
    cerca(larga.funding, 3 * PERFILES['futuros'].funding));
  const spot = costesOperacion('spot', { horasEnPosicion: 100 });
  comprobar('el spot nunca paga funding aunque dure mucho', spot.funding === 0);
}

console.log('\nEscenario neto — caso del seguimiento real de 15m');
{
  const E = 77493, SL = 77293, TP = 77692;

  const spot = escenarioNeto(E, SL, TP, 'spot');
  comprobar('en spot el R:R neto se hunde por debajo de 0,2',
    spot.rrNeto < 0.2, spot.rrNeto + ':1');
  comprobar('y exige acertar mas del 80%',
    spot.winRateMinimoNeto > 80, spot.winRateMinimoNeto.toFixed(1) + '%');
  comprobar('la mordida supera el 70% del beneficio bruto',
    spot.mordidaPct > 70, spot.mordidaPct.toFixed(0) + '%');

  const fut = escenarioNeto(E, SL, TP, 'futuros');
  comprobar('futuros mejora mucho el R:R neto frente a spot',
    fut.rrNeto > spot.rrNeto * 2, fut.rrNeto + ' vs ' + spot.rrNeto);

  const futMaker = escenarioNeto(E, SL, TP, 'futuros', { entradaComoMaker: true });
  comprobar('entrar como maker lo mejora todavia mas',
    futMaker.rrNeto > fut.rrNeto, futMaker.rrNeto + ' vs ' + fut.rrNeto);

  comprobar('el R:R neto es siempre peor que el bruto',
    [spot, fut, futMaker].every((x) => x.rrNeto < x.rrBruto));
  comprobar('y el acierto minimo exigido es siempre mayor',
    [spot, fut, futMaker].every((x) => x.winRateMinimoNeto > x.winRateMinimoBruto));
}

console.log('\nObjetivos que no cubren costes');
{
  // Objetivo a 0,05%: por debajo del coste de ida y vuelta en spot.
  const malo = escenarioNeto(77000, 76800, 77000 * 1.0005, 'spot');
  comprobar('un objetivo menor que los costes se marca no viable',
    malo.viable === false, 'neto ' + malo.netoGananciaPct.toFixed(4) + '%');
  comprobar('y su R:R neto es negativo o cero', malo.rrNeto <= 0, String(malo.rrNeto));

  const bueno = escenarioNeto(77000, 76000, 79000, 'futuros');
  comprobar('un objetivo amplio si es viable', bueno.viable === true);
  comprobar('y conserva la mayor parte del bruto',
    bueno.mordidaPct < 10, bueno.mordidaPct.toFixed(1) + '%');
}

console.log('\nRecorrido minimo por perfil');
{
  const spot = recorridoMinimo('spot');
  const fut = recorridoMinimo('futuros');
  const futMaker = recorridoMinimo('futuros', 0.2, { entradaComoMaker: true });

  comprobar('spot exige mas recorrido que futuros', spot > fut,
    (spot * 100).toFixed(3) + '% vs ' + (fut * 100).toFixed(3) + '%');
  comprobar('futuros maker es el mas barato de todos', futMaker < fut && futMaker < spot,
    (futMaker * 100).toFixed(3) + '%');
  comprobar('exigir menos mordida obliga a mas recorrido',
    recorridoMinimo('futuros', 0.1) > recorridoMinimo('futuros', 0.3));
}

console.log('\nExpectativa neta');
{
  comprobar('en el umbral neto la expectativa es cero',
    cerca(expectativaNeta(2, 1 / 3), 0, 1e-9));
  comprobar('un R:R neto de 0,12 con 50% de acierto pierde dinero',
    expectativaNeta(0.12, 0.5) < 0, expectativaNeta(0.12, 0.5).toFixed(3) + 'R');
  comprobar('un R:R neto de 2,5 con 40% de acierto gana',
    expectativaNeta(2.5, 0.4) > 0, expectativaNeta(2.5, 0.4).toFixed(3) + 'R');
}

console.log('\n' + '-'.repeat(52));
console.log('Pasados: ' + pasados + '   Fallados: ' + fallados);
process.exit(fallados === 0 ? 0 : 1);
