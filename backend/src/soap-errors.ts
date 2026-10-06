import { TrimbleResponseError } from './trimble.js';

/** Classify errors without returning request XML, credentials or remote fault text. */
export function soapErrorMessage(error:unknown,trimble:boolean) {
  if(error instanceof TrimbleResponseError)return error.message;
  const e=(error&&typeof error==='object'?error:{}) as {
    code?:string;message?:string;response?:{status?:number};root?:{Envelope?:{Body?:{Fault?:unknown}}}
  };
  const name=trimble?'Trimble pollTraces':'SOAP';
  const suffix=trimble?' Znacznik mark nie został przesunięty.':'';
  let reason:string;
  switch(e.response?.status){
    case 401:reason='HTTP 401: serwer odrzucił uwierzytelnienie. Sprawdź login i hasło konta SOAP w edycji workera (nie token ADMIN_TOKEN).';break;
    case 403:reason='HTTP 403: serwer odmówił dostępu. Sprawdź uprawnienia konta do usługi SOAP.';break;
    case 404:reason='HTTP 404: nie znaleziono usługi. Sprawdź adres endpointu SOAP.';break;
    case 429:reason='HTTP 429: przekroczono limit zapytań. Poczekaj na ponowienie.';break;
    default:
      if(e.root?.Envelope?.Body?.Fault)reason='Serwer zwrócił SOAP Fault. Sprawdź idclient, mark i uprawnienia konta.';
      else if(['ETIMEDOUT','ECONNABORTED'].includes(e.code??''))reason='Przekroczono czas oczekiwania na odpowiedź.';
      else if(['ENOTFOUND','EAI_AGAIN'].includes(e.code??''))reason='Nie można rozwiązać nazwy hosta. Sprawdź adres i DNS.';
      else if(['ECONNREFUSED','ECONNRESET','ENETUNREACH','EHOSTUNREACH'].includes(e.code??''))reason='Nie można nawiązać lub utrzymać połączenia z serwerem SOAP.';
      else if(['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'].includes(e.code??''))reason='Nieprawidłowy certyfikat TLS serwera SOAP.';
      else if(e.code==='ERR_BAD_RESPONSE'&&e.message?.includes('maxContentLength'))reason='Odpowiedź przekroczyła dopuszczalny rozmiar.';
      else if(Number.isInteger(e.response?.status)&&e.response!.status!>=400&&e.response!.status!<=599)reason=`Serwer odpowiedział HTTP ${e.response!.status}.`;
      else reason='Nie udało się odczytać odpowiedzi. Sprawdź konfigurację operacji SOAP i parametry.';
  }
  return `${name}: ${reason}${suffix}`;
}
