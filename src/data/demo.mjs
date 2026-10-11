export const photoSource = 'https://commons.wikimedia.org/wiki/File:The_rooftops_of_Lisbon.jpg';
export function demoCase() {
  return {
    id: 'findwhere-demo-lisbon',
    title: 'The view from above',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
    demo: true,
    photo: '/lisbon.jpg',
    fileName: 'the-rooftops-of-lisbon.jpg',
    metadata: {
      Dimensions: '3,888 × 2,592 (original)',
      Camera: 'Canon EOS 400D DIGITAL',
      'Capture date': '7 June 2009 · source metadata',
      GPS: '38.712170, −9.133801 · Commons reference',
    },
    candidates: [
      {
        id: 'demo-castle',
        name: 'Castelo de São Jorge',
        country: 'Lisbon, Portugal',
        lat: 38.71217,
        lng: -9.133801,
        confidence: 'high',
        status: 'supported',
        source: 'demo',
        reason:
          'The camera position is documented on the Wikimedia Commons source page. This sample uses published reference data.',
      },
      {
        id: 'demo-graca',
        name: 'Miradouro da Graça',
        country: 'Lisbon, Portugal',
        lat: 38.7162,
        lng: -9.1315,
        confidence: 'low',
        status: 'hypothesis',
        source: 'demo',
        reason:
          'An illustrative alternative viewpoint. Compare the ordering of the skyline and nearby landmarks before accepting it.',
      },
      {
        id: 'demo-alcantara',
        name: 'São Pedro de Alcântara',
        country: 'Lisbon, Portugal',
        lat: 38.7152,
        lng: -9.1441,
        confidence: 'low',
        status: 'ruled-out',
        source: 'demo',
        reason:
          'Illustrative rejected alternative: a viewpoint across the city would change the alignment of the foreground landmarks.',
      },
    ],
    clues: [
      {
        id: 'demo-architecture',
        category: 'Architecture',
        text: 'Dense terracotta rooftops and pale rendered façades are visible across the hillside.',
        source: 'Sample visual observation',
        checked: true,
      },
      {
        id: 'demo-landmark',
        category: 'Landmark',
        text: 'The source page identifies the Carmo Convent and Santa Justa lift in the scene.',
        source: 'Wikimedia Commons annotations',
        checked: true,
        url: photoSource,
      },
      {
        id: 'demo-source',
        category: 'Provenance',
        text: 'Published camera coordinates place the photographer at Castelo de São Jorge.',
        source: 'Wikimedia Commons camera location',
        checked: true,
        url: photoSource,
      },
      {
        id: 'demo-time',
        category: 'Time',
        text: 'Compare with historical imagery: the source describes a photograph from June 2009.',
        source: 'Wikimedia Commons metadata',
        checked: false,
        url: photoSource,
      },
    ],
    notes:
      'Sample investigation. The main location comes from the published photo source, not a live AI result. Alternative candidates demonstrate how to compare and rule out viewpoints.\n\nPhoto: “The rooftops of Lisbon” by Bert K. / Bert Kaufmann, CC BY 2.0, via Wikimedia Commons. Displayed as a resized preview.',
  };
}
