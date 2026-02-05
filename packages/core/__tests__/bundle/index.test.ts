/**
 * Bundle 모듈 전체 export 테스트
 */

import { describe, it, expect } from 'vitest';
import * as bundle from '../../src/bundle/index.js';

describe('Bundle Module Exports', () => {
  describe('Errors', () => {
    it('BundleError를 export해야 한다', () => {
      expect(bundle.BundleError).toBeDefined();
    });

    it('ParseError를 export해야 한다', () => {
      expect(bundle.ParseError).toBeDefined();
    });

    it('ValidationError를 export해야 한다', () => {
      expect(bundle.ValidationError).toBeDefined();
    });

    it('ReferenceError를 export해야 한다', () => {
      expect(bundle.ReferenceError).toBeDefined();
    });

    it('isBundleError를 export해야 한다', () => {
      expect(bundle.isBundleError).toBeDefined();
    });
  });

  describe('Parser', () => {
    it('parseYaml을 export해야 한다', () => {
      expect(bundle.parseYaml).toBeDefined();
    });

    it('parseMultiDocument를 export해야 한다', () => {
      expect(bundle.parseMultiDocument).toBeDefined();
    });

    it('DEFAULT_API_VERSION을 export해야 한다', () => {
      expect(bundle.DEFAULT_API_VERSION).toBeDefined();
    });
  });

  describe('Validator', () => {
    it('validateResource를 export해야 한다', () => {
      expect(bundle.validateResource).toBeDefined();
    });

    it('validateResources를 export해야 한다', () => {
      expect(bundle.validateResources).toBeDefined();
    });

    it('validateNameUniqueness를 export해야 한다', () => {
      expect(bundle.validateNameUniqueness).toBeDefined();
    });

    it('validateObjectRef를 export해야 한다', () => {
      expect(bundle.validateObjectRef).toBeDefined();
    });

    it('validateValueSource를 export해야 한다', () => {
      expect(bundle.validateValueSource).toBeDefined();
    });

    it('validateScopesSubset를 export해야 한다', () => {
      expect(bundle.validateScopesSubset).toBeDefined();
    });
  });

  describe('Resolver', () => {
    it('resolveObjectRef를 export해야 한다', () => {
      expect(bundle.resolveObjectRef).toBeDefined();
    });

    it('resolveAllReferences를 export해야 한다', () => {
      expect(bundle.resolveAllReferences).toBeDefined();
    });

    it('detectCircularReferences를 export해야 한다', () => {
      expect(bundle.detectCircularReferences).toBeDefined();
    });

    it('createResourceIndex를 export해야 한다', () => {
      expect(bundle.createResourceIndex).toBeDefined();
    });
  });

  describe('Loader', () => {
    it('loadBundleFromString을 export해야 한다', () => {
      expect(bundle.loadBundleFromString).toBeDefined();
    });

    it('loadBundleFromFile을 export해야 한다', () => {
      expect(bundle.loadBundleFromFile).toBeDefined();
    });

    it('loadBundleFromDirectory를 export해야 한다', () => {
      expect(bundle.loadBundleFromDirectory).toBeDefined();
    });
  });
});
