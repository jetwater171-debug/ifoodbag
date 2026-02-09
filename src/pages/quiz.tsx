import React from 'react';

const html = "<header class=\"header\">\r\n        <div class=\"logo-container\">\r\n            <img src=\\"/assets/ifoodentregadores.webp\" alt=\"iFood Entregador\" class=\"ifood-logo ifood-logo--wide\">\r\n        </div>\r\n    </header>\r\n\r\n    <noscript class=\"no-js\">Para continuar, ative o JavaScript no navegador.</noscript>\r\n\r\n    <main class=\"container\">\r\n        <section class=\"step\" aria-hidden=\"false\">\r\n            <div class=\"step-header\">\r\n                <span id=\"question-count\" class=\"step-count\">PERGUNTA 1 DE 9</span>\r\n                <div class=\"progress-bar\">\r\n                    <div id=\"progress-fill\" class=\"progress\" style=\"width: 0%\"></div>\r\n                </div>\r\n            </div>\r\n\r\n            <h2 id=\"question-text\">Pergunta aqui</h2>\r\n            <div id=\"options-container\" class=\"options\"></div>\r\n\r\n\r\n        </section>\r\n    </main>\r\n\r\n    <div id=\"toast\" class=\"toast hidden\" role=\"status\" aria-live=\"polite\"></div>\r\n\r\n    <footer class=\"footer\">\r\n        <p>&copy; 2026 iFood. Todos os direitos reservados.</p>\r\n    </footer>";

export default function QuizPage() {
  return <div className="page-root" dangerouslySetInnerHTML={{ __html: html }} />;
}


