/**
 * MODULO 9 - Seleccion diaria.
 *
 * EL PROBLEMA QUE RESUELVE: hasta ahora habia que elegir a mano la
 * temporalidad de referencia (--escenario 15m, 1h, 4h...). Eso es una
 * decision que el operador no deberia tomar por intuicion: la temporalidad
 * adecuada es simplemente la que ese dia ofrece el mejor escenario NETO, y
 * eso se puede calcular.
 *
 * QUE HACE: evalua todas las temporalidades x ambas direcciones, descarta las
 * combinaciones que no superan los criterios minimos, y ordena el resto por
 * calidad. Una operacion puede durar horas o dias: el horizonte lo fija la
 * geometria del escenario, no un marco temporal elegido de antemano.
 *
 * PRINCIPIO: todo descarte queda ESCRITO con su motivo. Un selector que dice
 * "este" sin decir por que descarto los otros es una caja negra, y en ese caso
 * daria igual que eligiera al azar.
 */
import { construirEscenarios } from './escenarios.mjs';

/**
 * Criterios minimos. Son umbrales explicitos y discutibles, no verdades.
 * Estan aqui arriba, juntos y visibles, para poder cambiarlos y volver a
 * medir su efecto en el backtest.
 */
export const CRITERIOS = {
  // R:R NETO minimo. Por debajo de 1 harian falta mas aciertos que fallos
  // solo para empatar, y no tenemos ninguna evidencia de acertar tanto.
  rrNetoMinimo: 1.0,
  // Los costes no deben comerse mas de esta fraccion del beneficio bruto.
  mordidaMaxima: 35,
  // Un stop mas alla de esto obliga a un riesgo desproporcionado.
  riesgoMaximoATR: 3.0,
  // Recorrido minimo al objetivo, en ATR de su propia temporalidad: por
  // debajo de 1 ATR el objetivo esta dentro del ruido de una sola vela.
  recorridoMinimoATR: 1.0,
  /**
   * TECHO DE RECORRIDO. Sin el, el selector elige SIEMPRE el objetivo mas
   * lejano, porque el R:R crece de forma mecanica con la distancia: un
   * objetivo a 10 ATR da un R:R espectacular y no se alcanza casi nunca.
   * El ratio por si solo no puede ordenar candidatos — hay que acotar la
   * distancia, o se convierte en un buscador de objetivos imposibles.
   */
  recorridoMaximoATR: 3.0,
};

/**
 * De todos los objetivos de un escenario, el mejor candidato: el de mayor
 * R:R neto entre los que son alcanzables. No siempre es el mas lejano — un
 * objetivo lejanisimo tiene R:R alto pero se alcanza pocas veces.
 */
function mejorObjetivo(escenario, criterios) {
  const viables = escenario.objetivos.filter((o) =>
    o.viable !== false
    && o.rrNeto !== null
    && o.distanciaATR <= criterios.recorridoMaximoATR   // acotado, ver CRITERIOS
    && o.distanciaATR >= criterios.recorridoMinimoATR
  );
  if (!viables.length) return null;
  return viables.reduce((a, b) => (b.rrNeto > a.rrNeto ? b : a));
}

/** Evalua una combinacion temporalidad x direccion y devuelve su ficha. */
function evaluarCandidato(analisisTf, escenario, sintesis, criterios) {
  const objetivo = mejorObjetivo(escenario, criterios);
  const descartes = [];
  const penalizaciones = [];

  if (!objetivo) {
    const masCercano = escenario.objetivos[0];
    descartes.push(masCercano && masCercano.distanciaATR > criterios.recorridoMaximoATR
      ? 'Todos los objetivos estan a mas de ' + criterios.recorridoMaximoATR + ' ATR (el mas cercano a '
        + masCercano.distanciaATR + '): inalcanzables en un horizonte operable.'
      : 'Ningun objetivo cubre los costes o queda dentro del rango operable.');
  } else {
    if (objetivo.rrNeto < criterios.rrNetoMinimo) {
      descartes.push('R:R neto ' + objetivo.rrNeto + ':1, por debajo del minimo de '
        + criterios.rrNetoMinimo + ':1 (exigiria acertar mas del '
        + objetivo.winRateMinimoNetoPct + '%).');
    }
    if (objetivo.mordidaCostesPct > criterios.mordidaMaxima) {
      descartes.push('Los costes se comen el ' + objetivo.mordidaCostesPct
        + '% del beneficio bruto (maximo ' + criterios.mordidaMaxima + '%).');
    }
  }

  if (escenario.riesgoATR > criterios.riesgoMaximoATR) {
    descartes.push('La invalidacion esta a ' + escenario.riesgoATR
      + ' ATR: riesgo desproporcionado para el grafico.');
  }

  // Penalizaciones: no descartan, pero bajan la calidad del candidato.
  if (!escenario.alineadoConSesgo) {
    penalizaciones.push({ motivo: 'va en contra del sesgo tecnico agregado', puntos: 25 });
  }
  if (escenario.invalidacion.base.startsWith('suelo')) {
    penalizaciones.push({ motivo: 'el stop no se apoya en estructura real, sino en el suelo de ATR', puntos: 20 });
  }
  if (objetivo && objetivo.origen.startsWith('proyeccion')) {
    penalizaciones.push({ motivo: 'el objetivo es una proyeccion de volatilidad, no un nivel observado', puntos: 15 });
  }
  if (analisisTf.indicadores.volRel !== null && analisisTf.indicadores.volRel < 0.7) {
    penalizaciones.push({ motivo: 'volumen por debajo del 70% de lo normal', puntos: 10 });
  }

  /**
   * CALIDAD. Parte de 100 y resta las penalizaciones, mas un componente
   * proporcional al R:R neto. No es una probabilidad ni pretende serlo: es
   * un orden de preferencia entre candidatos del mismo dia, con todos sus
   * ingredientes a la vista.
   */
  const baseRR = objetivo ? Math.min(40, objetivo.rrNeto * 15) : 0;
  const restado = penalizaciones.reduce((s, p) => s + p.puntos, 0);
  const calidad = Math.max(0, Math.min(100, 60 + baseRR - restado));

  return {
    temporalidad: analisisTf.temporalidad,
    direccion: escenario.direccion,
    alineadoConSesgo: escenario.alineadoConSesgo,
    precio: escenario.precioReferencia,
    invalidacion: escenario.invalidacion,
    riesgoATR: escenario.riesgoATR,
    riesgoUnitario: escenario.riesgoUnitario,
    objetivo,
    activacion: escenario.activacion,
    atr: analisisTf.indicadores.atr14,
    descartes,
    penalizaciones,
    calidad: objetivo ? Number(calidad.toFixed(0)) : 0,
    apto: descartes.length === 0,
  };
}

/**
 * Recorre todas las temporalidades disponibles y devuelve el ranking del dia.
 * `costes` es { perfil, opciones } y se propaga a todos los escenarios.
 */
export function seleccionDiaria(analisis, sintesis, costes, criterios = CRITERIOS) {
  const candidatos = [];

  for (const a of analisis) {
    const { escenarios } = construirEscenarios(a, sintesis, costes);
    for (const esc of escenarios) {
      candidatos.push(evaluarCandidato(a, esc, sintesis, criterios));
    }
  }

  const aptos = candidatos.filter((c) => c.apto).sort((a, b) => b.calidad - a.calidad);
  const rechazados = candidatos.filter((c) => !c.apto).sort((a, b) => b.calidad - a.calidad);

  return {
    criterios,
    costes,
    evaluados: candidatos.length,
    aptos,
    rechazados,
    mejor: aptos[0] ?? null,
    /**
     * Que no haya ningun candidato apto es un resultado legitimo y frecuente.
     * La mayoria de dias el grafico no ofrece nada con recorrido suficiente
     * para cubrir costes con holgura. Forzar una operacion esos dias significa
     * pagar comision por operar ruido, y eso es una perdida garantizada a
     * cambio de una ganancia incierta.
     */
    hayApto: aptos.length > 0,
    motivoSiNoHay: aptos.length === 0
      ? 'Ninguna de las ' + candidatos.length + ' combinaciones evaluadas supera los '
        + 'criterios minimos. Los motivos concretos de cada descarte estan abajo.'
      : null,
  };
}
