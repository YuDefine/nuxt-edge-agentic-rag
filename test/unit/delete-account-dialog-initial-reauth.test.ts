import { h, ref } from 'vue'
import { mockComponent, mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PENDING_DELETE_REAUTH_KEY,
  consumePendingDeleteReauth,
  peekGenericReturnTo,
} from '~/utils/auth-return-to'

const socialSignIn = vi.fn()
const passkeySignIn = vi.fn()
const signOutAndRedirect = vi.fn()
const toastAdd = vi.fn()

mockNuxtImport('useUserSession', () => () => ({
  loggedIn: ref(true),
  signIn: {
    passkey: passkeySignIn,
    social: socialSignIn,
  },
  user: ref({ id: 'user-1' }),
}))

mockNuxtImport('useSignOutRedirect', () => () => ({
  signOutAndRedirect,
}))

mockNuxtImport('useToast', () => () => ({
  add: toastAdd,
}))

mockComponent('UModal', {
  props: {
    dismissible: {
      type: Boolean,
      required: false,
      default: true,
    },
    open: {
      type: Boolean,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
  },
  emits: ['update:open'],
  setup(props, { slots }) {
    return () =>
      props.open
        ? h('section', { 'data-testid': 'delete-modal' }, [
            h('h2', props.title),
            h('div', { 'data-testid': 'modal-body' }, slots.body?.()),
            h('div', { 'data-testid': 'modal-footer' }, slots.footer?.()),
          ])
        : null
  },
})

mockComponent('LazyUAlert', {
  props: {
    description: {
      type: String,
      required: false,
      default: '',
    },
    title: {
      type: String,
      required: false,
      default: '',
    },
  },
  setup(props) {
    return () => h('div', [props.title, props.description].filter(Boolean).join(' '))
  },
})

mockComponent('UButton', {
  props: {
    disabled: {
      type: Boolean,
      required: false,
      default: false,
    },
    loading: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  setup(props, { attrs, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled || props.loading,
          type: 'button',
        },
        slots.default?.(),
      )
  },
})

async function mountDeleteAccountDialog(props: {
  hasGoogle: boolean
  hasPasskey: boolean
  initialReauthComplete?: boolean
  open: boolean
}) {
  const module = await import('~/components/auth/DeleteAccountDialog.vue')
  return mountSuspended(module.default, { props })
}

function findConfirmButton(wrapper: Awaited<ReturnType<typeof mountDeleteAccountDialog>>) {
  const button = wrapper.findAll('button').find((item) => item.text().includes('確認刪除'))
  if (!button) throw new Error('Confirm delete button not found')
  return button
}

describe('DeleteAccountDialog initial reauth state', () => {
  beforeEach(() => {
    sessionStorage.clear()
    socialSignIn.mockReset()
    passkeySignIn.mockReset()
    signOutAndRedirect.mockReset()
    toastAdd.mockReset()
  })

  it('opens on the confirm step when initialReauthComplete is true', async () => {
    const wrapper = await mountDeleteAccountDialog({
      open: true,
      hasGoogle: true,
      hasPasskey: true,
      initialReauthComplete: true,
    })

    expect(wrapper.text()).toContain('重新驗證身分 （已完成）')
    expect(wrapper.text()).not.toContain('使用 Google 重新驗證')
    expect(wrapper.text()).not.toContain('使用 Passkey 重新驗證')
    expect(findConfirmButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('keeps the existing reauth step when initialReauthComplete is false', async () => {
    const wrapper = await mountDeleteAccountDialog({
      open: true,
      hasGoogle: true,
      hasPasskey: true,
    })

    expect(wrapper.text()).toContain('使用 Google 重新驗證')
    expect(wrapper.text()).toContain('使用 Passkey 重新驗證')
    expect(findConfirmButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('stores the resume signal before starting Google reauth through the callback bridge', async () => {
    socialSignIn.mockResolvedValue({})
    const wrapper = await mountDeleteAccountDialog({
      open: true,
      hasGoogle: true,
      hasPasskey: false,
    })

    await wrapper.get('button:not([disabled])').trigger('click')

    expect(peekGenericReturnTo()).toBe('/account/settings?open-delete=1')
    expect(sessionStorage.getItem(PENDING_DELETE_REAUTH_KEY)).toBeTruthy()
    expect(socialSignIn).toHaveBeenCalledWith({
      provider: 'google',
      callbackURL: '/auth/callback',
    })
    expect(consumePendingDeleteReauth()).toBe(true)
  })

  it('does not show reauth as complete before the Google OAuth callback resumes the dialog', async () => {
    socialSignIn.mockResolvedValue({})
    const wrapper = await mountDeleteAccountDialog({
      open: true,
      hasGoogle: true,
      hasPasskey: false,
    })

    await wrapper.get('button:not([disabled])').trigger('click')

    expect(wrapper.text()).not.toContain('重新驗證身分 （已完成）')
    expect(wrapper.text()).toContain('使用 Google 重新驗證')
    expect(findConfirmButton(wrapper).attributes('disabled')).toBeDefined()
  })
})
