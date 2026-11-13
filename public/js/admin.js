document.querySelectorAll('form[data-confirmar]').forEach((formulario) => {
  formulario.addEventListener('submit', (evento) => {
    if (!window.confirm(formulario.dataset.confirmar)) evento.preventDefault();
  });
});

document.querySelectorAll('tr[data-registro]').forEach((linha) => {
  linha.addEventListener('click', (evento) => {
    if (evento.target.closest('a, button')) return;
    linha.querySelector('a[href]').click();
  });
});
