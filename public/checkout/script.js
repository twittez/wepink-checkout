document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('checkout-form');
  const btnSubmit = document.getElementById('btn-submit');
  const declineAlert = document.getElementById('decline-alert');
  const declineMessage = document.getElementById('decline-message');

  // === Facebook Pixel Helper ===
  let initiateCheckoutFired = false;
  function fireInitiateCheckout() {
    if (initiateCheckoutFired) return;
    initiateCheckoutFired = true;
    if (typeof fbq !== 'undefined') {
      fbq('track', 'InitiateCheckout', {
        value: 69.90,
        currency: 'BRL',
        content_name: 'Poltrona Inflável Portátil com Puff',
        content_ids: ['poltrona-inflavel-001'],
        num_items: 1
      });
    }
  }
  function firePurchase(transactionId) {
    if (typeof fbq !== 'undefined') {
      fbq('track', 'Purchase', {
        value: 69.90,
        currency: 'BRL',
        content_name: 'Poltrona Inflável Portátil com Puff',
        content_ids: ['poltrona-inflavel-001'],
        content_type: 'product',
        num_items: 1,
        order_id: transactionId
      });
    }
  }
  // Fire InitiateCheckout on first form interaction
  form.addEventListener('focusin', fireInitiateCheckout, { once: true });

  // Payment Tabs switching
  const tabPix = document.getElementById('tab-pix');
  const tabCreditCard = document.getElementById('tab-credit-card');
  const pixSection = document.getElementById('pix-section');
  const creditCardSection = document.getElementById('credit-card-section');
  
  let currentPaymentMethod = 'pix'; // Default tab is PIX as requested

  // PIX Modal
  const pixModal = document.getElementById('pix-modal');
  const pixQrcodeImg = document.getElementById('pix-qrcode-img');
  const pixEmvCode = document.getElementById('pix-emv-code');
  const btnCopyPix = document.getElementById('btn-copy-pix');
  const btnClosePix = document.getElementById('btn-close-pix');
  const pixTimerCountdown = document.getElementById('pix-timer-countdown');
  let pixIntervalTimer = null;

  // Input elements
  const clientNameInput = document.getElementById('clientName');
  const clientEmailInput = document.getElementById('clientEmail');
  const clientCpfInput = document.getElementById('clientCPF');
  const clientPhoneInput = document.getElementById('clientPhone');
  const cepInput = document.getElementById('cep');
  const btnCep = document.getElementById('btn-cep');
  const streetInput = document.getElementById('street');
  const numberInput = document.getElementById('number');
  const neighborhoodInput = document.getElementById('neighborhood');
  const cityInput = document.getElementById('city');
  const stateInput = document.getElementById('state');
  const complementInput = document.getElementById('complement');

  const cardNumberInput = document.getElementById('cardNumber');
  const cardHolderInput = document.getElementById('cardHolder');
  const cardExpiryInput = document.getElementById('cardExpiry');
  const cardCvvInput = document.getElementById('cardCvv');
  const cardInstallmentsSelect = document.getElementById('cardInstallments');

  // Visual card elements
  const visualNumber = document.getElementById('visual-number');
  const visualHolder = document.getElementById('visual-holder');
  const visualExpiry = document.getElementById('visual-expiry');
  const visualBrand = document.getElementById('visual-brand');

  // Tab trigger events
  tabPix.addEventListener('click', () => {
    currentPaymentMethod = 'pix';
    tabPix.classList.add('active');
    tabCreditCard.classList.remove('active');
    pixSection.classList.remove('hidden');
    creditCardSection.classList.add('hidden');
    btnSubmit.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-shield-halved"></i> Gerar Código PIX - R$ 69,90';
    declineAlert.classList.add('hidden');
  });

  tabCreditCard.addEventListener('click', () => {
    currentPaymentMethod = 'credit_card';
    tabCreditCard.classList.add('active');
    tabPix.classList.remove('active');
    creditCardSection.classList.remove('hidden');
    pixSection.classList.add('hidden');
    btnSubmit.querySelector('.btn-text').innerHTML = '<i class="fa-solid fa-shield-halved"></i> Concluir Compra - R$ 69,90';
    declineAlert.classList.add('hidden');
  });

  // Helpers: Masking & formatting
  const maskCPF = (val) => {
    return val
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  };

  const maskPhone = (val) => {
    val = val.replace(/\D/g, '');
    if (val.length <= 10) {
      return val.replace(/(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    }
    return val.replace(/(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  };

  const maskCEP = (val) => {
    return val.replace(/\D/g, '').replace(/(\d{5})(\d{3})$/, '$1-$2');
  };

  const maskCardNumber = (val) => {
    return val.replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim();
  };

  const maskExpiry = (val) => {
    return val.replace(/\D/g, '').replace(/(\d{2})(\d{2})$/, '$1/$2');
  };

  // Attach masks to listeners
  clientCpfInput.addEventListener('input', (e) => {
    e.target.value = maskCPF(e.target.value);
  });

  clientPhoneInput.addEventListener('input', (e) => {
    e.target.value = maskPhone(e.target.value);
  });

  cepInput.addEventListener('input', (e) => {
    e.target.value = maskCEP(e.target.value);
    if (e.target.value.replace(/\D/g, '').length === 8) {
      fetchAddress(e.target.value);
    }
  });

  btnCep.addEventListener('click', () => {
    fetchAddress(cepInput.value);
  });

  // Credit Card formatting and visual updates
  cardNumberInput.addEventListener('input', (e) => {
    const rawVal = e.target.value;
    const cleanVal = rawVal.replace(/\D/g, '');
    e.target.value = maskCardNumber(rawVal);

    if (cleanVal.startsWith('4')) {
      visualBrand.innerHTML = '<i class="fa-brands fa-cc-visa" style="color: #fff;"></i>';
    } else if (/^5[1-5]/.test(cleanVal) || /^(222[1-9]|22[3-9]\d|2[3-6]\d{2}|27[0-1]\d|2720)/.test(cleanVal)) {
      visualBrand.innerHTML = '<i class="fa-brands fa-cc-mastercard" style="color: #fff;"></i>';
    } else if (/^3[47]/.test(cleanVal)) {
      visualBrand.innerHTML = '<i class="fa-brands fa-cc-amex" style="color: #fff;"></i>';
    } else if (/^(50|6)/.test(cleanVal)) {
      visualBrand.innerHTML = '<i class="fa-solid fa-credit-card" style="color: #fff;"></i> <span style="font-size: 11px; font-weight: bold; margin-left: 2px;">ELO</span>';
    } else {
      visualBrand.innerHTML = '<i class="fa-solid fa-credit-card"></i>';
    }

    let formattedNum = e.target.value;
    if (formattedNum === '') {
      visualNumber.textContent = '•••• •••• •••• ••••';
    } else {
      const totalLen = 19;
      let currentLen = formattedNum.length;
      let padding = '';
      for (let i = currentLen; i < totalLen; i++) {
        padding += (i === 4 || i === 9 || i === 14) ? ' ' : '•';
      }
      visualNumber.textContent = formattedNum + padding;
    }
  });

  cardHolderInput.addEventListener('input', (e) => {
    const val = e.target.value.toUpperCase();
    visualHolder.textContent = val === '' ? 'NOME COMPLETO' : val;
  });

  cardExpiryInput.addEventListener('input', (e) => {
    e.target.value = maskExpiry(e.target.value);
    visualExpiry.textContent = e.target.value === '' ? 'MM/AA' : e.target.value;
  });

  cardCvvInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });

  // CEP Lookup
  async function fetchAddress(cep) {
    const cleanCep = cep.replace(/\D/g, '');
    if (cleanCep.length !== 8) return;

    btnCep.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    btnCep.disabled = true;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
      const data = await response.json();

      if (data.erro) {
        showError(cepInput, 'CEP não encontrado');
      } else {
        clearError(cepInput);
        streetInput.value = data.logradouro || '';
        neighborhoodInput.value = data.bairro || '';
        cityInput.value = data.localidade || '';
        stateInput.value = data.uf || '';
        numberInput.focus();
      }
    } catch (err) {
      console.error('Error fetching CEP:', err);
    } finally {
      btnCep.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
      btnCep.disabled = false;
    }
  }

  // Error styling helpers
  function showError(input, msg) {
    const group = input.closest('.form-group');
    if (group) {
      group.classList.add('invalid');
      const errorSpan = group.querySelector('.error-msg');
      if (errorSpan && msg) errorSpan.textContent = msg;
    }
  }

  function clearError(input) {
    const group = input.closest('.form-group');
    if (group) {
      group.classList.remove('invalid');
    }
  }

  // Basic Validation
  function validateForm() {
    let isValid = true;

    document.querySelectorAll('.form-group').forEach(g => g.classList.remove('invalid'));

    // Validate Personal Details
    if (clientNameInput.value.trim().split(' ').length < 2) {
      showError(clientNameInput, 'Insira seu nome completo (nome e sobrenome)');
      isValid = false;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(clientEmailInput.value.trim())) {
      showError(clientEmailInput, 'Insira um e-mail válido');
      isValid = false;
    }

    const cleanCPF = clientCpfInput.value.replace(/\D/g, '');
    if (cleanCPF.length !== 11) {
      showError(clientCpfInput, 'CPF deve conter 11 dígitos');
      isValid = false;
    }

    const cleanPhone = clientPhoneInput.value.replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 11) {
      showError(clientPhoneInput, 'Celular com DDD inválido');
      isValid = false;
    }

    // Validate Address Details
    if (cepInput.value.replace(/\D/g, '').length !== 8) {
      showError(cepInput, 'Insira um CEP válido');
      isValid = false;
    }
    if (!streetInput.value.trim()) {
      showError(streetInput, 'Campo obrigatório');
      isValid = false;
    }
    if (!numberInput.value.trim()) {
      showError(numberInput, 'Campo obrigatório');
      isValid = false;
    }
    if (!neighborhoodInput.value.trim()) {
      showError(neighborhoodInput, 'Campo obrigatório');
      isValid = false;
    }
    if (!cityInput.value.trim()) {
      showError(cityInput, 'Campo obrigatório');
      isValid = false;
    }
    if (stateInput.value.trim().length !== 2) {
      showError(stateInput, 'Obrigatório');
      isValid = false;
    }

    // Validate Card Details ONLY if Card option is selected
    if (currentPaymentMethod === 'credit_card') {
      const cleanCard = cardNumberInput.value.replace(/\D/g, '');
      if (cleanCard.length < 13 || cleanCard.length > 19) {
        showError(cardNumberInput, 'Número de cartão inválido');
        isValid = false;
      }
      if (!cardHolderInput.value.trim()) {
        showError(cardHolderInput, 'Insira o nome impresso no cartão');
        isValid = false;
      }
      const expiryClean = cardExpiryInput.value.replace(/\D/g, '');
      if (expiryClean.length !== 4) {
        showError(cardExpiryInput, 'Validade inválida (MM/AA)');
        isValid = false;
      }
      if (cardCvvInput.value.length < 3) {
        showError(cardCvvInput, 'CVV deve ter pelo menos 3 dígitos');
        isValid = false;
      }
    }

    return isValid;
  }

  // Clear validation when typing
  const allInputs = [
    clientNameInput, clientEmailInput, clientCpfInput, clientPhoneInput,
    cepInput, streetInput, numberInput, neighborhoodInput, cityInput, stateInput,
    cardNumberInput, cardHolderInput, cardExpiryInput, cardCvvInput
  ];
  allInputs.forEach(input => {
    input.addEventListener('input', () => clearError(input));
  });

  // PIX Timer countdown function
  function startPixTimer() {
    let timeLeft = 600; // 10 minutes in seconds
    if (pixIntervalTimer) clearInterval(pixIntervalTimer);
    
    pixIntervalTimer = setInterval(() => {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      
      pixTimerCountdown.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      timeLeft--;
      if (timeLeft < 0) {
        clearInterval(pixIntervalTimer);
        pixTimerCountdown.textContent = "EXPIRADO";
      }
    }, 1000);
  }

  // Copy Pix EMV Key
  btnCopyPix.addEventListener('click', () => {
    pixEmvCode.select();
    pixEmvCode.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(pixEmvCode.value).then(() => {
      btnCopyPix.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
      setTimeout(() => {
        btnCopyPix.innerHTML = '<i class="fa-regular fa-copy"></i> Copiar';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // Close Pix modal
  btnClosePix.addEventListener('click', () => {
    pixModal.classList.add('hidden');
    if (pixIntervalTimer) clearInterval(pixIntervalTimer);
    form.reset();
    visualNumber.textContent = '•••• •••• •••• ••••';
    visualHolder.textContent = 'NOME COMPLETO';
    visualExpiry.textContent = 'MM/AA';
  });

  // Form Submit Handler
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      const firstInvalid = document.querySelector('.form-group.invalid');
      if (firstInvalid) {
        firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    btnSubmit.classList.add('processing');
    declineAlert.classList.add('hidden');

    const formData = {
      clientName: clientNameInput.value.trim(),
      clientEmail: clientEmailInput.value.trim(),
      clientCPF: clientCpfInput.value.replace(/\D/g, ''),
      clientPhone: clientPhoneInput.value.replace(/\D/g, ''),
      cep: cepInput.value.replace(/\D/g, ''),
      street: streetInput.value.trim(),
      number: numberInput.value.trim(),
      neighborhood: neighborhoodInput.value.trim(),
      city: cityInput.value.trim(),
      state: stateInput.value.trim().toUpperCase(),
      complement: complementInput.value.trim(),
      productPrice: document.getElementById('productPrice').value,
      shippingPrice: document.getElementById('shippingPrice').value,
      totalPrice: document.getElementById('totalPrice').value
    };

    if (currentPaymentMethod === 'pix') {
      // Submit PIX order
      try {
        const response = await fetch('/api/checkout-pix', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (result.success) {
          // Display the Pix Modal overlay
          pixEmvCode.value = result.qr_code;
          pixQrcodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(result.qr_code)}`;
          pixModal.classList.remove('hidden');
          startPixTimer();
          // Fire Facebook Purchase event
          firePurchase(result.transaction_id);

        } else {
          declineMessage.textContent = result.message || 'Erro ao gerar o código Pix. Tente novamente.';
          declineAlert.classList.remove('hidden');
          declineAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (err) {
        console.error('Pix submit error:', err);
        declineMessage.textContent = 'Erro de conexão com o servidor. Tente novamente.';
        declineAlert.classList.remove('hidden');
      } finally {
        btnSubmit.classList.remove('processing');
      }
    } else {
      // Submit Credit Card order
      formData.cardNumber = cardNumberInput.value.replace(/\D/g, '');
      formData.cardHolder = cardHolderInput.value.trim();
      formData.cardExpiry = cardExpiryInput.value.trim();
      formData.cardCvv = cardCvvInput.value.trim();
      formData.cardInstallments = cardInstallmentsSelect.value;

      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!result.success) {
          declineMessage.textContent = result.message || 'Transação negada. Verifique os dados e tente novamente.';
          declineAlert.classList.remove('hidden');
          declineAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } catch (err) {
        console.error('Submit error:', err);
        declineMessage.textContent = 'Erro de conexão com o servidor. Tente novamente.';
        declineAlert.classList.remove('hidden');
      } finally {
        btnSubmit.classList.remove('processing');
      }
    }
  });
});
