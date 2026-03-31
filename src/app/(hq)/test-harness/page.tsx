'use client';

import { useState } from 'react';
import { TacTextareaWithImages } from '@/components/ui/tac-textarea-with-images';
import {
  TacSelect,
  TacSelectContent,
  TacSelectItem,
  TacSelectTrigger,
  TacSelectValue,
} from '@/components/ui/tac-select';
import {
  TacModal,
  TacModalTrigger,
  TacModalContent,
  TacModalHeader,
  TacModalTitle,
  TacModalDescription,
  TacModalFooter,
  TacModalClose,
} from '@/components/ui/modal';
import { TacButton } from '@/components/ui/tac-button';

/**
 * Test harness page for E2E testing of UI components.
 * Only useful in E2E_TEST_MODE — not linked from navigation.
 */
export default function TestHarnessPage() {
  const [textareaValue, setTextareaValue] = useState('');
  const [selectValue, setSelectValue] = useState('');

  return (
    <div className="p-6 space-y-8 max-w-2xl" data-testid="test-harness">
      <h1 className="text-dr-amber font-tactical text-lg uppercase tracking-wider">
        Component Test Harness
      </h1>

      {/* TacTextareaWithImages */}
      <section data-testid="section-textarea">
        <h2 className="text-dr-text font-tactical text-sm uppercase tracking-wider mb-2">
          Textarea With Images
        </h2>
        <TacTextareaWithImages
          value={textareaValue}
          onChange={setTextareaValue}
          placeholder="Type or paste images here..."
          data-testid="tac-textarea"
        />
        <div data-testid="textarea-output" className="text-dr-muted text-xs mt-1 font-mono break-all">
          {textareaValue}
        </div>
      </section>

      {/* TacSelect */}
      <section data-testid="section-select">
        <h2 className="text-dr-text font-tactical text-sm uppercase tracking-wider mb-2">
          Select Component
        </h2>
        <TacSelect value={selectValue} onValueChange={(val) => setSelectValue(val ?? '')}>
          <TacSelectTrigger data-testid="tac-select-trigger">
            <TacSelectValue placeholder="Choose an asset..." />
          </TacSelectTrigger>
          <TacSelectContent>
            <TacSelectItem value="recon">Recon</TacSelectItem>
            <TacSelectItem value="engineer">Engineer</TacSelectItem>
            <TacSelectItem value="medic">Medic</TacSelectItem>
            <TacSelectItem value="sniper">Sniper</TacSelectItem>
          </TacSelectContent>
        </TacSelect>
        <div data-testid="select-output" className="text-dr-muted text-xs mt-1 font-mono">
          {selectValue || '(none selected)'}
        </div>
      </section>

      {/* TacModal */}
      <section data-testid="section-modal">
        <h2 className="text-dr-text font-tactical text-sm uppercase tracking-wider mb-2">
          Modal Component
        </h2>
        <TacModal>
          <TacModalTrigger render={<TacButton data-testid="modal-trigger" />}>
            Open Modal
          </TacModalTrigger>
          <TacModalContent data-testid="modal-content">
            <TacModalHeader>
              <TacModalTitle>Mission Briefing</TacModalTitle>
              <TacModalDescription>Review the mission parameters before deployment.</TacModalDescription>
            </TacModalHeader>
            <div className="p-5">
              <p className="text-dr-text text-sm" data-testid="modal-body">
                This is the modal body content for testing.
              </p>
            </div>
            <TacModalFooter>
              <TacModalClose render={<TacButton variant="ghost" data-testid="modal-cancel" />}>
                Cancel
              </TacModalClose>
              <TacModalClose render={<TacButton data-testid="modal-confirm" />}>
                Confirm
              </TacModalClose>
            </TacModalFooter>
          </TacModalContent>
        </TacModal>
      </section>
    </div>
  );
}
